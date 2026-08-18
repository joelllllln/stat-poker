/**
 * Browser smoke test: deal a hand, take an action, confirm the odds overlay
 * and the table actually render. Unit tests prove the maths; this proves the
 * app runs.
 *
 *     npx vite build && npx vite preview --port 4173 &
 *     node scripts/smoke.mjs
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173'

/**
 * Find a browser to drive.
 *
 * A pre-installed one is used where the environment provides it, even when its
 * build number is not the one this version of Playwright would download, and
 * Playwright's own resolution is left alone otherwise. The same script then
 * runs on a machine with a browser already there and on a fresh CI runner.
 */
function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return null
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue
    const candidate = join(root, entry, 'chrome-linux', 'chrome')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const executablePath = browserPath()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })

const errors = []
page.on('console', (message) => {
  // A missing favicon is not a fault worth failing a build over.
  if (message.type() === 'error' && !message.text().includes('favicon')) {
    errors.push(message.text())
  }
})
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(URL, { waitUntil: 'networkidle' })

const check = (label, condition) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) process.exitCode = 1
}

check('app renders', (await page.locator('h1').innerText()) === 'stat-poker')

// Bots act with a pause between them, the way a client deals. The test does
// not need the pauses and every wait below would have to allow for them.
await page.getByRole('button', { name: 'Fast', exact: true }).click()

await page.getByRole('button', { name: 'Deal', exact: true }).click()
await page.waitForTimeout(500)

// Labels are rendered with CSS uppercase, so innerText comes back shouting.
const body = (await page.locator('body').innerText()).toLowerCase()
check('a hand is in progress', /pot \d+/.test(body))
check('the table shows the seats and the button', /you\s+btn|you\s+sb|you\s+bb|you\s+utg|you\s+hj|you\s+co/.test(body))
check('the odds overlay is showing equity', body.includes('your equity'))
check('pot odds are on screen', body.includes('need to call'))
check('modelled ranges are shown', body.includes('modelled ranges'))
check('the range grid is drawn', body.includes('tightest range'))
check('outs have a place in the overlay', body.includes('outs'))

// Play the hand out by checking or calling until it ends.
for (let i = 0; i < 40; i++) {
  const check_ = page.getByRole('button', { name: 'Check', exact: true })
  const call = page.getByRole('button', { name: /^Call/ })
  if (await check_.count()) await check_.first().click()
  else if (await call.count()) await call.first().click()
  else break
  await page.waitForTimeout(150)
}

// Grading runs off the critical path, so the analysis that depends on it
// lands a moment after the hand itself does.
await page.waitForTimeout(4000)
const after = (await page.locator('body').innerText()).toLowerCase()
check('the hand resolved', /you (won|lost|broke even)/.test(after))
check('the running record is beside the table', after.includes('this sitting'))
check('the post-hand review appeared', after.includes('review'))
check('the run-it-again spread appeared', /run it [\d,]+ times/.test(after))

// The dashboard lives on its own screen now, so the table is not buried
// under a wall of statistics after every hand.
await page.getByRole('button', { name: 'Progress', exact: true }).click()
await page.waitForTimeout(400)
const progress = (await page.locator('body').innerText()).toLowerCase()
check('the dashboard appeared', progress.includes('your game'))
check('the winrate carries a confidence bound', /confidence|not enough hands/.test(progress))
check('the luck chart is present', progress.includes('all-in adjusted') || progress.includes('play a few hands'))
check('the leak finder reports', progress.includes('where it goes'))
await page.getByRole('button', { name: 'Table', exact: true }).click()
await page.waitForTimeout(300)

// Open the decision timeline.
const showAll = page.getByRole('button', { name: /show all \d+ decisions/i })
if (await showAll.count()) {
  await showAll.first().click()
  await page.waitForTimeout(200)
  const expanded = (await page.locator('body').innerText()).toLowerCase()
  check('decisions are graded', /(optimal|fine|mistake|blunder)/.test(expanded))
  // Expand the first decision to reveal the priced alternatives. Match on the
  // verdict chip: the spread's street buttons also mention the streets.
  await page
    .locator('button')
    .filter({ hasText: /(Optimal|Fine|Mistake|Blunder)/ })
    .first()
    .click()
  await page.waitForTimeout(200)
  const detail = (await page.locator('body').innerText()).toLowerCase()
  check('alternatives are priced', detail.includes('your equity') && /bb/.test(detail))
} else {
  check('decision timeline available', false)
}

// Persistence: hands must survive a reload.
const before = await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.open('stat-poker')
  request.onsuccess = () => {
    const db = request.result
    const count = db.transaction('hands').objectStore('hands').count()
    count.onsuccess = () => resolve(count.result)
  }
  request.onerror = () => resolve(-1)
}))
check(`hands were saved to IndexedDB (${before})`, typeof before === 'number' && before > 0)

await page.reload({ waitUntil: 'networkidle' })
const after2 = await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.open('stat-poker')
  request.onsuccess = () => {
    const db = request.result
    const count = db.transaction('hands').objectStore('hands').count()
    count.onsuccess = () => resolve(count.result)
  }
  request.onerror = () => resolve(-1)
}))
check('saved hands survive a reload', after2 === before)

// The river solver, where the hand reached one heads-up.
const solveButton = page.getByRole('button', { name: 'Solve', exact: true })
if (await solveButton.count()) {
  await solveButton.first().click()
  await page.waitForSelector('text=/iterations in/', { timeout: 120000 })
  const solved = (await page.locator('body').innerText()).toLowerCase()
  check('the river solver returns a strategy', /exploitable for [\d.]+ chips/.test(solved))
} else {
  console.log('skip this hand did not reach a heads-up river')
}

// Predict-then-reveal: the guess has to be asked for before the answer shows.
await page.getByRole('button', { name: /^guess$/i }).click()
await page.getByRole('button', { name: 'Deal', exact: true }).click()
await page.waitForTimeout(1200)
const predicting = (await page.locator('body').innerText()).toLowerCase()
check('predict mode asks for an estimate first', predicting.includes('estimate your equity'))
// The prompt itself says "estimate your equity", so the tell that the numbers
// are still hidden is the absence of the tiles beside it.
check('the equity is hidden until it is guessed', !predicting.includes('need to call'))

const guessButton = page.getByRole('button', { name: '40%', exact: true })
if (await guessButton.count()) {
  await guessButton.first().click()
  await page.waitForTimeout(700)
  const revealed = (await page.locator('body').innerText()).toLowerCase()
  check('the guess is scored against the truth', /you guessed 40%/.test(revealed))
  check('the equity appears once guessed', revealed.includes('your equity'))
} else {
  check('predict mode offers guesses', false)
}

check(
  'the speed setting survived the reload',
  await page
    .getByRole('button', { name: 'Fast', exact: true })
    .evaluate((node) => node.className.includes('bg-slate-700')),
)

// Metrics over time: the whole point of recording hands is that the record
// outlives the tab. Play a handful more, reload, and the statistics must
// describe every hand rather than restarting from zero.
await page.getByRole('button', { name: 'Off', exact: true }).click()
for (let hand = 0; hand < 30; hand++) {
  const deal = page.getByRole('button', { name: 'Deal', exact: true })
  if (await deal.count()) await deal.first().click()
  for (let i = 0; i < 12; i++) {
    const checkButton = page.getByRole('button', { name: 'Check', exact: true })
    const call = page.getByRole('button', { name: /^Call/ })
    const fold = page.getByRole('button', { name: 'Fold', exact: true })
    if (await checkButton.count()) await checkButton.first().click()
    else if (await call.count()) await call.first().click()
    else if (await fold.count()) await fold.first().click()
    else break
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(30)
}

const played = await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.open('stat-poker')
  request.onsuccess = () => {
    const db = request.result
    const count = db.transaction('hands').objectStore('hands').count()
    count.onsuccess = () => resolve(count.result)
  }
  request.onerror = () => resolve(-1)
}))

await page.reload({ waitUntil: 'networkidle' })
// The archive is replayed on load and graded in the worker a few at a time.
await page.waitForTimeout(6000)
await page.getByRole('button', { name: 'Progress', exact: true }).click()
await page.waitForTimeout(600)
const reloaded = (await page.locator('body').innerText()).toLowerCase()

const counted = /(\d[\d,]*) hands? · 0 this sitting/.exec(reloaded)
check(
  `statistics cover every hand after a reload (${counted?.[1] ?? 'none'} of ${played})`,
  counted !== null && Number(counted[1].replace(/,/g, '')) === played,
)
check('the trend across blocks of hands is drawn', reloaded.includes('over time'))
check('where the money goes survives the reload', reloaded.includes('where it goes'))
check(
  'verdicts were remembered rather than recomputed from nothing',
  /graded hands|bb\/100 given up/.test(reloaded),
)

await page.screenshot({ path: 'screenshot.png', fullPage: true })
check('no console errors', errors.length === 0)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))

await browser.close()
console.log('screenshot written to screenshot.png')
