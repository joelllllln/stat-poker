/**
 * Browser smoke test: deal a hand, take an action, confirm the odds overlay
 * and the table actually render. Unit tests prove the maths; this proves the
 * app runs.
 *
 *     npx vite build && npx vite preview --port 4173 &
 *     node scripts/smoke.mjs
 */

import { chromium } from 'playwright'

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
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

await page.getByRole('button', { name: 'Deal' }).click()
await page.waitForTimeout(500)

// Labels are rendered with CSS uppercase, so innerText comes back shouting.
const body = (await page.locator('body').innerText()).toLowerCase()
check('a hand is in progress', /pot \d+/.test(body))
check('the odds overlay is showing equity', body.includes('your equity'))
check('pot odds are on screen', body.includes('need to call'))
check('modelled ranges are shown', body.includes('modelled ranges'))

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
await page.waitForTimeout(2500)
const after = (await page.locator('body').innerText()).toLowerCase()
check('the hand resolved', /you (won|lost|broke even)/.test(after))
check('the dashboard appeared', after.includes('your game'))
check('the winrate carries a confidence bound', /confidence|not enough hands/.test(after))
check('the luck chart is present', after.includes('all-in adjusted') || after.includes('play a few hands'))
check('the leak finder reports', after.includes('where it goes'))
check('the post-hand review appeared', after.includes('review'))
check('the run-it-again spread appeared', /run it [\d,]+ times/.test(after))

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

await page.screenshot({ path: 'screenshot.png', fullPage: true })
check('no console errors', errors.length === 0)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))

await browser.close()
console.log('screenshot written to screenshot.png')
