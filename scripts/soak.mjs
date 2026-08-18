/**
 * A long sitting, in a real browser.
 *
 * The unit tests play hands in Node and the smoke test plays a few in a
 * browser. Neither answers what happens after an hour: whether the interface
 * stays responsive as the history grows, whether the background grading keeps
 * up, whether memory climbs, whether a reload with hundreds of stored hands is
 * still quick, and whether anything quietly throws on the way.
 *
 *     npx vite build && npx vite preview --port 4173 &
 *     node scripts/soak.mjs --hands 400
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

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

const URL = process.env.SOAK_URL ?? 'http://localhost:4173'
const argv = process.argv.slice(2)
const at = argv.indexOf('--hands')
const HANDS = at >= 0 ? Number(argv[at + 1]) : 300

const executablePath = browserPath()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

const problems = []
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('favicon')) {
    problems.push(`console: ${message.text()}`)
  }
})
page.on('pageerror', (error) => problems.push(`page: ${String(error)}`))
page.on('requestfailed', (request) => problems.push(`request: ${request.url()}`))

const timings = []
const say = (line) => console.log(line)

async function press(locator, timeout = 5_000) {
  if ((await locator.count()) === 0) return false
  try {
    await locator.first().click({ timeout })
    return true
  } catch {
    return false
  }
}

const started = Date.now()
await page.goto(URL, { waitUntil: 'networkidle' })
say(`Loaded an empty history in ${Date.now() - started}ms`)

// Play fast, with the odds and the live coach off: this is about the parts
// that accumulate, not about the parts already measured per decision. On a
// phone the settings live behind the button in the header.
await press(page.getByRole('button', { name: 'Settings', exact: true }))
for (const setting of ['Fast', 'Hide', 'After the hand']) {
  if (!(await press(page.getByRole('button', { name: setting, exact: true })))) {
    say(`  (could not set ${setting})`)
  }
}

let played = 0
for (let hand = 0; hand < HANDS; hand++) {
  const handStarted = Date.now()
  if (!(await press(page.getByRole('button', { name: 'Deal', exact: true }), 10_000))) break

  for (let step = 0; step < 14; step++) {
    // Wait for the hand to want something — either the hero is on the clock,
    // or it is over and the next one can be dealt. Racing the two is what
    // keeps a folded hand from costing a full timeout.
    const acting = await Promise.race([
      page
        .getByRole('button', { name: /^(Check|Call|Fold)/ })
        .first()
        .waitFor({ timeout: 8_000 })
        .then(() => true)
        .catch(() => false),
      page
        .getByRole('button', { name: 'Deal', exact: true })
        .first()
        .waitFor({ timeout: 8_000 })
        .then(() => false)
        .catch(() => false),
    ])
    if (!acting) break

    const check = page.getByRole('button', { name: 'Check', exact: true })
    const call = page.getByRole('button', { name: /^Call/ })
    const fold = page.getByRole('button', { name: 'Fold', exact: true })
    // A mix, so the history is not one kind of hand.
    const aggressive = hand % 3 === 0
    if (await press(check)) continue
    if (aggressive && (await press(call))) continue
    if (await press(fold)) continue
    break
  }

  played += 1
  timings.push(Date.now() - handStarted)

  if (played % 50 === 0) {
    const memory = await page.evaluate(() =>
      performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null,
    )
    const recent = timings.slice(-50)
    say(
      `  ${played} hands · ${Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)}ms a hand` +
        (memory === null ? '' : ` · ${memory}MB heap`),
    )
  }
}

const counts = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open('stat-poker')
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction(['hands', 'grades'])
        const hands = transaction.objectStore('hands').count()
        const grades = transaction.objectStore('grades').count()
        transaction.oncomplete = () => resolve({ hands: hands.result, grades: grades.result })
      }
      request.onerror = () => resolve({ hands: -1, grades: -1 })
    }),
)

// Grading runs a few hands at a time in the worker; give it a while and see
// how far it gets, because the mastery rating depends on it catching up.
const gradingStarted = Date.now()
await page.waitForTimeout(30_000)
const after = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open('stat-poker')
      request.onsuccess = () => {
        const count = request.result.transaction('grades').objectStore('grades').count()
        count.onsuccess = () => resolve(count.result)
      }
      request.onerror = () => resolve(-1)
    }),
)

// What a returning player waits for.
const reloadStarted = Date.now()
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Progress', exact: true }).click()
// The dashboard's own heading, which appears once the archive has been
// replayed and the statistics rebuilt: that is what a returning player waits
// for, not the first paint.
await page
  .getByText('Your game', { exact: false })
  .first()
  .waitFor({ timeout: 120_000 })
  .catch(() => say('  (the dashboard never appeared)'))
const reloadMs = Date.now() - reloadStarted
const dashboard = (await page.locator('body').innerText()).toLowerCase()
const shown = /([\d,]+) hands? ·/.exec(dashboard)

const sorted = [...timings].sort((a, b) => a - b)
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0

const report = {
  hands: played,
  stored: counts.hands,
  gradedBefore: counts.grades,
  gradedAfter: after,
  gradingRatePerMinute: Math.round(((after - counts.grades) / (Date.now() - gradingStarted)) * 60_000),
  handMs: { median: percentile(0.5), p90: percentile(0.9), worst: sorted[sorted.length - 1] ?? 0 },
  reloadWithHistoryMs: reloadMs,
  dashboardHands: shown ? Number(shown[1].replace(/,/g, '')) : null,
  problems: [...new Set(problems)].slice(0, 20),
}

say('')
say(JSON.stringify(report, null, 2))
writeFileSync('soak-report.json', `${JSON.stringify(report, null, 2)}\n`)

if (report.problems.length > 0) process.exitCode = 1
if (report.dashboardHands !== null && report.dashboardHands < played) {
  say(`MISMATCH: played ${played} but the dashboard describes ${report.dashboardHands}`)
  process.exitCode = 1
}

await browser.close()
