/**
 * Every screen the game has to fit on.
 *
 * The layout has been tuned against a phone and a laptop, which are two of the
 * shapes people actually hold. This walks a real device matrix — small phones,
 * big phones, both orientations, the whole iPad range, laptops and desktops —
 * and reports the same four things for each: whether anything overflows
 * sideways, whether anything lands on top of anything else, whether the
 * controls are reachable without scrolling, and whether everything you tap is
 * big enough to tap.
 *
 *     npx vite build && npx vite preview --port 4173 &
 *     node scripts/sizes.mjs
 */

import { existsSync, readdirSync } from 'node:fs'
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

const URL = process.env.SIZES_URL ?? 'http://localhost:4173'

/**
 * The shapes, in CSS pixels.
 *
 * `touch` marks the ones held in a hand, where a control has to be 44px before
 * it counts as tappable. A laptop has a pointer and does not.
 */
const SCREENS = [
  { name: 'iPhone SE', width: 320, height: 568, touch: true },
  { name: 'Galaxy S8', width: 360, height: 740, touch: true },
  { name: 'iPhone 13 mini', width: 375, height: 812, touch: true },
  { name: 'iPhone 14', width: 390, height: 844, touch: true },
  { name: 'Pixel 7', width: 412, height: 915, touch: true },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, touch: true },
  { name: 'iPhone SE landscape', width: 568, height: 320, touch: true },
  { name: 'iPhone 14 landscape', width: 844, height: 390, touch: true },
  { name: 'Pixel 7 landscape', width: 915, height: 412, touch: true },
  { name: 'iPad mini', width: 744, height: 1133, touch: true },
  { name: 'iPad', width: 820, height: 1180, touch: true },
  { name: 'iPad Pro 11', width: 834, height: 1194, touch: true },
  { name: 'iPad landscape', width: 1180, height: 820, touch: true },
  { name: 'iPad Pro 12.9', width: 1024, height: 1366, touch: true },
  { name: 'iPad Pro 12.9 landscape', width: 1366, height: 1024, touch: true },
  { name: 'small laptop', width: 1280, height: 720, touch: false },
  { name: 'laptop', width: 1440, height: 900, touch: false },
  { name: 'desktop', width: 1920, height: 1080, touch: false },
  { name: 'wide desktop', width: 2560, height: 1440, touch: false },
]

const executablePath = browserPath()
const browser = await chromium.launch(executablePath ? { executablePath } : {})

const problems = []
let page = null

const press = async (locator, timeout = 5_000) => {
  if ((await locator.count()) === 0) return false
  try {
    await locator.first().click({ timeout })
    return true
  } catch {
    return false
  }
}

/** Everything worth knowing about how the page sits at one size. */
const survey = () =>
  page.evaluate(() => {
    const seen = (node) => {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    // Boxes that must never touch: the seats, the chips in front of them, the
    // board, and the controls.
    const boxes = [...document.querySelectorAll('[data-seat], [data-chips], [data-board], [data-action]')]
      .filter(seen)
      .map((node) => ({
        name: node.dataset.seat ?? node.dataset.chips ?? node.dataset.action ?? 'board',
        box: node.getBoundingClientRect(),
      }))

    const clashes = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box
        const b = boxes[j].box
        if (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        ) {
          clashes.push(`${boxes[i].name}×${boxes[j].name}`)
        }
      }
    }

    const actions = [...document.querySelectorAll('[data-action]')].filter(seen)
    const tappable = [...document.querySelectorAll('button, [role="button"], input[type="range"]')]
      .filter(seen)
      .map((node) => {
        const box = node.getBoundingClientRect()
        return { label: (node.textContent ?? node.ariaLabel ?? '?').trim().slice(0, 16), size: Math.min(box.width, box.height) }
      })
      .sort((a, b) => a.size - b.size)

    const felt = [...document.querySelectorAll('.felt')].find(seen) ?? null
    const main = document.querySelector('main') ?? document.body.firstElementChild

    return {
      clashes,
      tracked: boxes.length,
      overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
      pageHeight: Math.round(document.documentElement.scrollHeight),
      viewport: window.innerHeight,
      controlsBottom: actions.length
        ? Math.round(Math.max(...actions.map((n) => n.getBoundingClientRect().bottom)))
        : null,
      smallestTap: tappable.length ? Math.round(tappable[0].size) : 0,
      smallestLabel: tappable[0]?.label ?? '',
      feltWidth: felt ? Math.round(felt.getBoundingClientRect().width) : 0,
      contentWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
    }
  })

const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) process.exitCode = 1
}

const rows = []
for (const screen of SCREENS) {
  // A fresh context per screen, because whether the device has a touch screen
  // is a property of the context rather than of the viewport — and it is what
  // decides how big a control has to be.
  const context = await browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    hasTouch: screen.touch,
    isMobile: screen.touch && screen.width < 600,
  })
  page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) {
      problems.push(`${screen.name} console: ${m.text()}`)
    }
  })
  page.on('pageerror', (e) => problems.push(`${screen.name} page: ${String(e)}`))

  await page.goto(URL, { waitUntil: 'networkidle' })
  await press(page.getByRole('button', { name: 'Sit down', exact: true }))
  await page.waitForTimeout(400)

  /**
   * Get a hand in front of the player, so there is something to measure.
   *
   * The deal button exists but is disabled while the others are still acting,
   * so this waits for it to be pressable rather than looking once and giving
   * up — the difference between measuring the game and measuring the pause.
   */
  const onTheClock = async () => {
    if ((await page.locator('[data-action="fold"]:not([disabled])').count()) > 0) return true
    try {
      await page.locator('button:has-text("Deal")').first().click({ timeout: 15_000 })
    } catch {
      return false
    }
    return page
      .locator('[data-action="fold"]:not([disabled])')
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  }

  // Measured over a few hands: how far down the controls reach depends on the
  // hand — a holding whose name wraps, a blind to explain, a bet to size.
  let worst = null
  for (let hand = 0; hand < 4; hand++) {
    if (!(await onTheClock())) break
    const now = await survey()
    if (worst === null || (now.controlsBottom ?? 0) > (worst.controlsBottom ?? 0)) worst = now
    if (!(await press(page.locator('[data-action="fold"]:not([disabled])'), 2_000))) break
  }
  rows.push({ screen, measured: worst ?? (await survey()) })
  await context.close()
}

console.log('')
console.log(
  'screen'.padEnd(26) + 'size'.padEnd(12) + 'reach'.padEnd(14) + 'tap'.padEnd(7) + 'felt'.padEnd(7) + 'wide?',
)
for (const { screen, measured } of rows) {
  const reach =
    measured.controlsBottom === null
      ? 'no controls'
      : `${measured.controlsBottom}/${measured.viewport}`
  console.log(
    `${screen.name.padEnd(26)}${`${screen.width}×${screen.height}`.padEnd(12)}${reach.padEnd(14)}` +
      `${String(measured.smallestTap).padEnd(7)}${String(measured.feltWidth).padEnd(7)}` +
      `${measured.overflows ? 'OVERFLOWS' : ''}${measured.clashes.length ? ` CLASH ${measured.clashes.slice(0, 3).join(',')}` : ''}`,
  )
}
console.log('')

for (const { screen, measured } of rows) {
  check(`${screen.name}: nothing overlaps`, measured.clashes.length === 0)
  check(`${screen.name}: no sideways scrolling`, !measured.overflows)
  check(
    `${screen.name}: the controls are on the screen (${measured.controlsBottom}/${measured.viewport})`,
    measured.controlsBottom !== null && measured.controlsBottom <= measured.viewport,
  )
  if (screen.touch) {
    check(
      `${screen.name}: everything is tappable (${measured.smallestTap}px "${measured.smallestLabel}")`,
      measured.smallestTap >= 44,
    )
  }
}

check('no console errors', problems.length === 0)
if (problems.length) console.log(problems.slice(0, 8).join('\n'))

await browser.close()
