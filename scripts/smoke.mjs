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
import { readFileSync } from 'node:fs'
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

/**
 * Press a control, if it is there and ready to be pressed.
 *
 * Buttons are disabled while the other players act and while the coach prices
 * the decision, so a blind click is a race the test loses on a slow machine.
 * Everything the play-out loops press goes through here: it waits for the
 * control to be usable and reports failure rather than throwing, so a hand
 * that cannot be advanced ends the loop instead of the run.
 */
async function press(locator, timeout = 4_000) {
  if ((await locator.count()) === 0) return false
  try {
    await locator.first().click({ timeout })
    return true
  } catch {
    return false
  }
}

/** Deal the next hand, once the table is ready for one. */
const dealNextHand = () =>
  press(page.getByRole('button', { name: 'Deal', exact: true }), 10_000)

check('app renders', (await page.locator('h1').innerText()) === 'stat-poker')

// Bots act with a pause between them, the way a client deals. The test does
// not need the pauses and every wait below would have to allow for them.
await page.getByRole('button', { name: 'Fast', exact: true }).click()

await page.getByRole('button', { name: 'Deal', exact: true }).click()

// The odds and the advice are both worked out off the interface thread, and a
// CI runner is slower than a laptop. Wait for them to land rather than
// guessing at a delay that happens to work here.
await page.waitForTimeout(500)
for (const wanted of ['Your hand is worth', 'What to do']) {
  await page
    .getByText(wanted, { exact: false })
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
}

// Labels are rendered with CSS uppercase, so innerText comes back shouting.
const body = (await page.locator('body').innerText()).toLowerCase()
check('a hand is in progress', /pot \d+/.test(body))
check('the table shows the seats and the button', /you\s+btn|you\s+sb|you\s+bb|you\s+utg|you\s+hj|you\s+co/.test(body))

/**
 * Nothing on the table may be drawn on top of anything else on it.
 *
 * Checked by measuring rather than by looking: every seat, the board, the pot
 * and every pile of chips reports its box, and no two boxes may intersect. The
 * same measurement at three widths is what stands behind the claim that the
 * layout holds up on a phone.
 */
async function overlapsAt(width, height) {
  await page.setViewportSize({ width, height })
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[data-seat], [data-board], [data-pot], [data-chips]'),
    ].filter((node) => node.getClientRects().length > 0 && node.getBoundingClientRect().width > 0)

    const boxes = nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        name:
          node.getAttribute('data-seat') ??
          (node.hasAttribute('data-chips') ? `chips ${node.getAttribute('data-chips')}` : null) ??
          (node.hasAttribute('data-board') ? 'board' : 'pot'),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }
    })

    const clashes = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        // A shared edge is not an overlap; a pixel of shared area is.
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (overlapX > 1 && overlapY > 1) clashes.push(`${a.name} × ${b.name}`)
      }
    }

    return {
      tracked: boxes.length,
      clashes,
      // A page that scrolls sideways is the other way a layout runs into
      // itself, and it is invisible to a box comparison.
      overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
    }
  })
}

/**
 * Can the game be played on this screen without scrolling?
 *
 * This is primarily a phone game, so the table and the controls have to share
 * one screen: a fold button below the fold is a fold button nobody presses.
 * Tap targets are measured at the same time, against the 44px both platforms
 * ask for.
 */
async function reachAt(width, height) {
  await page.setViewportSize({ width, height })
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const visible = [...document.querySelectorAll('button')].filter(
      (node) => node.getClientRects().length > 0,
    )
    const actions = visible.filter((node) => /^(Fold|Check|Call|Raise|Bet|Deal)\b/.test(node.textContent ?? ''))
    const smallest = visible
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return { label: (node.textContent ?? '').trim().slice(0, 14), size: Math.min(rect.width, rect.height) }
      })
      .sort((a, b) => a.size - b.size)[0]

    return {
      controlsBottom: actions.length
        ? Math.round(Math.max(...actions.map((node) => node.getBoundingClientRect().bottom)))
        : null,
      viewport: window.innerHeight,
      smallestTap: smallest ? Math.round(smallest.size) : 0,
      smallestLabel: smallest?.label ?? '',
    }
  })
}

for (const [name, width, height] of [
  ['iPhone', 390, 844],
  ['a small Android', 360, 740],
]) {
  const reach = await reachAt(width, height)
  check(
    `the table and the controls share one screen on ${name} (controls end at ${reach.controlsBottom} of ${reach.viewport})`,
    reach.controlsBottom !== null && reach.controlsBottom <= reach.viewport,
  )
  check(
    `every control on ${name} is thumb-sized (smallest ${reach.smallestTap}px: "${reach.smallestLabel}")`,
    reach.smallestTap >= 44,
  )
}

// The panels beside the table on a desktop are tabs under the controls here.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(300)
const tabs = await page.getByRole('tab').count()
check(`the coaching panels are tabs on a phone (${tabs})`, tabs >= 3)
if (tabs >= 3) {
  await press(page.getByRole('tab', { name: /^Hand/ }))
  await page.waitForTimeout(250)
  const onHand = (await page.locator('body').innerText()).toLowerCase()
  check('a phone tab shows its own panel', onHand.includes('what happened'))
  check(
    'and only its own panel',
    !onHand.includes('priced against what they are modelled to hold'),
  )
}

for (const [name, width, height] of [
  ['phone', 390, 844],
  ['tablet', 820, 1180],
  ['laptop', 1280, 800],
]) {
  const measured = await overlapsAt(width, height)
  check(
    `nothing overlaps on a ${name} (${measured.tracked} elements measured)`,
    measured.tracked >= 8 && measured.clashes.length === 0,
  )
  if (measured.clashes.length) console.log('   ', measured.clashes.slice(0, 6).join(', '))
  check(`the ${name} layout does not scroll sideways`, !measured.overflows)
}
await page.setViewportSize({ width: 1100, height: 1000 })
await page.waitForTimeout(300)
// Live coaching: what to do, at the moment the decision is live.
check('the coach says what to do while you decide', body.includes('what to do'))
check(
  'the recommendation is argued rather than asserted',
  /worth [\d.]+bb more than|everything else here loses money|the only action available|too close to separate/.test(
    body,
  ),
)
// The advice is worked out off the interface thread, so it lands a moment
// after the decision does.
const marked = await page
  .locator('.ring-emerald-300')
  .first()
  .waitFor({ timeout: 15_000 })
  .then(() => true)
  .catch(() => false)
check('the recommended action is marked on the control itself', marked)

// And a running account of what everyone else just did.
check('the hand is narrated', body.includes('what happened'))
check('the blinds are in the account', /posts the (small|big) blind/.test(body))
check(
  'the other players\' actions are in the account',
  /(raises to|calls|folds|checks|bets)/.test(body),
)
check(
  'the turn and the price are stated plainly',
  /your turn/.test(body) &&
    (/costs \d+ to win \d+/.test(body) || /free to see the next card/.test(body)),
)
// A beginner should never have to read two cards and a board to find out what
// they are holding: the app says it.
check(
  'the hand you hold is named in words',
  /you have (a pair of|two pair|three |a straight|a flush|a full house|four |royal|[a-z]+ high|[a-z]+-[a-z]+)/.test(
    body,
  ),
)

check('the odds panel says what the hand is worth', body.includes('your hand is worth'))
check('the price is stated in plain words', /the price is (good|bad)|nobody has bet/.test(body))
check('calling needs a number of its own', body.includes('calling needs'))

// The rest is deliberately folded away: two numbers answer the question being
// asked, and the working is one click behind them.
check('the detail is closed until asked for', !body.includes('what they might hold'))
const more = page.getByText('Show the rest', { exact: false })
if (await more.count()) {
  await more.first().click()
  await page.waitForTimeout(200)
  const opened = (await page.locator('body').innerText()).toLowerCase()
  check('outs are there when asked for', opened.includes('cards that put you ahead'))
  check('modelled ranges are there when asked for', opened.includes('what they might hold'))
  check('the range grid is drawn', opened.includes('tightest of those ranges'))
} else {
  check('the detail can be opened', false)
}

// Play the hand out by checking or calling until it ends.
for (let i = 0; i < 40; i++) {
  const check_ = page.getByRole('button', { name: 'Check', exact: true })
  const call = page.getByRole('button', { name: /^Call/ })
  if (!(await press(check_)) && !(await press(call))) break
  await page.waitForTimeout(150)
}

// Grading runs off the critical path, so the analysis that depends on it
// lands a moment after the hand itself does.
await page.waitForTimeout(4000)
const after = (await page.locator('body').innerText()).toLowerCase()
check('the hand resolved', /you (won|lost|broke even)/.test(after))

// Showdown is when a seat has the most to say — the cards, what it held, what
// it won — so it is the moment the boxes are largest and most likely to clash.
const atShowdown = await overlapsAt(1280, 800)
check(
  `nothing overlaps at showdown (${atShowdown.tracked} elements measured)`,
  atShowdown.clashes.length === 0,
)
if (atShowdown.clashes.length) console.log('   ', atShowdown.clashes.slice(0, 6).join(', '))

// One hand shows one betting pattern. The felt is most crowded when several
// players have chips in front of them at once, so this raises its way through
// a few hands and measures after every action rather than trusting one moment.
let busiest = 0
const acrossHands = []
for (let hand = 0; hand < 5; hand++) {
  await dealNextHand()
  for (let step = 0; step < 8; step++) {
    const raise = page.getByRole('button', { name: /^(Raise to|Bet) / })
    const call = page.getByRole('button', { name: /^Call/ })
    const checkButton = page.getByRole('button', { name: 'Check', exact: true })
    const acted =
      (step === 0 && (await press(raise))) ||
      (await press(checkButton)) ||
      (await press(call))
    if (!acted) break

    const measured = await overlapsAt(1280, 800)
    busiest = Math.max(busiest, measured.tracked)
    acrossHands.push(...measured.clashes)
  }
}
check(
  `nothing overlaps while the betting runs (up to ${busiest} elements on the felt)`,
  acrossHands.length === 0 && busiest >= 10,
)
if (acrossHands.length) console.log('   ', [...new Set(acrossHands)].slice(0, 6).join(', '))

await page.setViewportSize({ width: 1100, height: 1000 })
await page.waitForTimeout(300)
check('the running record is beside the table', after.includes('this sitting'))
check('the post-hand review appeared', after.includes('review'))
check('the run-it-again spread appeared', /run it [\d,]+ times/.test(after))

// The dashboard lives on its own screen now, so the table is not buried
// under a wall of statistics after every hand.
await page.getByRole('button', { name: 'Progress', exact: true }).click()
await page.waitForTimeout(400)
const progress = (await page.locator('body').innerText()).toLowerCase()
check('the dashboard appeared', progress.includes('your game'))
check(
  'the winrate carries a bound, in words rather than a confidence level',
  /somewhere between|not enough hands/.test(progress),
)
// And the whole page has to be readable by somebody who does not know the
// acronyms it is built out of.
check(
  'the statistics say what they mean',
  /hands in every 100/.test(progress) &&
    /big blinds a hand|breaking about even/.test(progress),
)
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
await page.getByRole('button', { name: 'Guess first', exact: true }).click()
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
  check('the equity appears once guessed', revealed.includes('your hand is worth'))
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
await page.getByRole('button', { name: 'Hide', exact: true }).click()
for (let hand = 0; hand < 30; hand++) {
  await dealNextHand()
  for (let i = 0; i < 12; i++) {
    const checkButton = page.getByRole('button', { name: 'Check', exact: true })
    const call = page.getByRole('button', { name: /^Call/ })
    const fold = page.getByRole('button', { name: 'Fold', exact: true })
    if (!(await press(checkButton)) && !(await press(call)) && !(await press(fold))) break
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

// The backup: local-first is only a promise if the hands can leave.
await page.getByRole('button', { name: 'Progress', exact: true }).click()
await page.waitForTimeout(300)
const download = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Save a copy', exact: true }).click(),
]).then(([event]) => event)
const backup = await download.path()
const saved = JSON.parse(readFileSync(backup, 'utf8'))
check(
  `the backup holds every hand (${saved.hands?.length ?? 0})`,
  Array.isArray(saved.hands) && saved.hands.length === played,
)

// And loading it back must not double the history it is meant to protect.
await page.setInputFiles('input[type=file]', backup)
await page.waitForTimeout(1200)
const afterLoad = await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.open('stat-poker')
  request.onsuccess = () => {
    const db = request.result
    const count = db.transaction('hands').objectStore('hands').count()
    count.onsuccess = () => resolve(count.result)
  }
  request.onerror = () => resolve(-1)
}))
check(`loading the same backup twice changes nothing (${afterLoad})`, afterLoad === played)

await page.screenshot({ path: 'screenshot.png', fullPage: true })
check('no console errors', errors.length === 0)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))

await browser.close()
console.log('screenshot written to screenshot.png')
