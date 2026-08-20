/**
 * Playing badly in a real browser, at tables nobody would choose.
 *
 * The unit fuzzers push the engine and the coach through every table shape in
 * Node. This does the same thing to the interface: sit down at a nine-handed
 * table on ten big blinds, shove every hand, bust, rebuy, get up, choose a
 * different table, sit down again. The failure it is looking for is not a
 * wrong number — it is the app wedging, with nothing to press and no way back.
 *
 *     npx vite build && npx vite preview --port 4173 &
 *     node scripts/tilt.mjs
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

const URL = process.env.TILT_URL ?? 'http://localhost:4173'
const argv = process.argv.slice(2)
const at = argv.indexOf('--hands')
const PER_TABLE = at >= 0 ? Number(argv[at + 1]) : 12

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

const check = (label, condition) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) process.exitCode = 1
}

async function press(locator, timeout = 5_000) {
  if ((await locator.count()) === 0) return false
  try {
    await locator.first().click({ timeout })
    return true
  } catch {
    return false
  }
}

await page.goto(URL, { waitUntil: 'networkidle' })

/** Set the table up from the setup screen and sit down at it. */
async function openSetup() {
  // The way back only exists on the table screen, so start from there.
  await press(page.getByRole('button', { name: 'Table', exact: true }), 1_500)
  await page.waitForTimeout(200)
  // On a phone the way back to the setup screen is behind the settings button,
  // where it costs no room on the felt.
  if (!(await press(page.getByRole('button', { name: 'Table setup', exact: true }), 1_500))) {
    await press(page.getByRole('button', { name: 'Settings', exact: true }))
    await page.waitForTimeout(200)
    await press(page.getByRole('button', { name: 'Table setup', exact: true }))
  }
  await page.waitForTimeout(300)
  return (await page.getByRole('button', { name: 'Sit down', exact: true }).count()) > 0
}

async function sitDownAt({ seats, stakes, stack, opponents }) {
  await openSetup()
  const slider = page.getByRole('slider', { name: 'Players at the table' })
  if ((await slider.count()) === 0) return false
  await slider.fill(String(seats))
  await press(page.getByRole('button', { name: stakes, exact: true }))
  await press(page.getByRole('button', { name: stack, exact: true }))

  // Turn every opponent off but the ones asked for, pressing the wanted ones
  // last so the "never leave the table empty" rule cannot bite.
  for (const name of ['The Rock', 'The Eagle', 'The Hawk', 'The Fish', 'The Maniac']) {
    const button = page.getByRole('button', { name: new RegExp(`^${name}`) })
    if ((await button.count()) === 0) continue
    const on = (await button.first().getAttribute('aria-pressed')) === 'true'
    const want = opponents.includes(name)
    if (on !== want) await press(button)
  }

  await press(page.getByRole('button', { name: 'Sit down', exact: true }))
  await page.waitForTimeout(400)
  return true
}

/**
 * Play one hand as badly as the controls allow, and say what happened.
 *
 * "stuck" is the answer this is hunting for: the hand neither wants an action
 * nor offers the next deal, which is the only failure a player cannot recover
 * from by pressing something.
 */
/** The deal button, once the previous hand has actually finished. */
const DEAL = 'button:has-text("Deal"):not([disabled])'

async function playOneHand(aggressive) {
  // The others are still acting for a second or so after the hero is out of
  // the hand, and the button is disabled while they do. Waiting for it to be
  // pressable rather than merely present is the difference between testing
  // the game and testing the pause.
  if (!(await press(page.locator(DEAL), 15_000))) return 'no deal'

  for (let step = 0; step < 16; step++) {
    const acting = await Promise.race([
      page
        .locator('[data-action="fold"], [data-action="check"], [data-action="call"]')
        .first()
        .waitFor({ timeout: 10_000 })
        .then(() => 'act')
        .catch(() => null),
      page
        .locator(DEAL)
        .first()
        .waitFor({ timeout: 10_000 })
        .then(() => 'done')
        .catch(() => null),
    ])
    if (acting === null) return 'stuck'
    if (acting === 'done') return 'done'

    // Shove if there is anything to shove with, otherwise call, otherwise
    // check, and only fold when there is nothing else — the fastest route to
    // busting a stack and finding out what the app does about it.
    // "All in" is a bet size, not an action: it fills in the amount, and the
    // raise button is what commits it.
    if (aggressive) await press(page.locator('[data-size="allin"]'), 2_000)
    if (aggressive && (await press(page.locator('[data-action="raise"]:not([disabled])'), 2_000))) continue
    if (await press(page.locator('[data-action="check"]:not([disabled])'), 2_000)) continue
    if (await press(page.locator('[data-action="call"]:not([disabled])'), 2_000)) continue
    if (await press(page.locator('[data-action="fold"]:not([disabled])'), 2_000)) continue
    return 'nothing to press'
  }
  return 'done'
}

/** Nothing on the felt may overlap anything else on it. */
async function overlaps() {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-seat], [data-chips], [data-board]')]
      .map((node) => ({ name: node.dataset.seat ?? node.dataset.chips ?? 'board', box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
    const clashes = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box
        const b = boxes[j].box
        const over =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        if (over) clashes.push(`${boxes[i].name}×${boxes[j].name}`)
      }
    }
    return { tracked: boxes.length, clashes }
  })
}

const TABLES = [
  { name: 'heads-up, short', seats: 2, stakes: '25 / 50', stack: 'Short', opponents: ['The Maniac'] },
  { name: 'nine-handed, short', seats: 9, stakes: '2 / 5', stack: 'Short', opponents: ['The Maniac', 'The Fish'] },
  { name: 'three-handed, deep', seats: 3, stakes: '1 / 2', stack: 'Deep', opponents: ['The Rock'] },
  { name: 'full ring, normal', seats: 9, stakes: '1 / 2', stack: 'Normal', opponents: ['The Rock', 'The Eagle', 'The Hawk', 'The Fish', 'The Maniac'] },
]

let totalPlayed = 0
for (const table of TABLES) {
  const seated = await sitDownAt(table)
  check(`sat down at ${table.name}`, seated)
  if (!seated) continue

  const outcomes = { done: 0, stuck: 0, 'no deal': 0, 'nothing to press': 0 }
  for (let hand = 0; hand < PER_TABLE; hand++) {
    const outcome = await playOneHand(hand % 4 !== 3)
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    if (outcome !== 'done') break
  }
  totalPlayed += outcomes.done

  check(
    `${table.name}: ${outcomes.done} hands played without wedging`,
    outcomes.done === PER_TABLE,
  )
  if (outcomes.done !== PER_TABLE) console.log('   ', JSON.stringify(outcomes))

  const felt = await overlaps()
  check(`${table.name}: nothing overlaps on the felt (${felt.tracked} boxes)`, felt.clashes.length === 0)
  if (felt.clashes.length) console.log('   ', felt.clashes.slice(0, 6).join(', '))

  // Busting and rebuying is the point of the short stacks: whatever happened,
  // every seat still has a stack, and none of them owes the house money.
  const stacks = await page.evaluate(() =>
    [...document.querySelectorAll('[data-seat]')].map((node) => {
      const found = /-?\d[\d,]*/.exec(node.textContent ?? '')
      return found ? Number(found[0].replace(/,/g, '')) : null
    }),
  )
  check(
    `${table.name}: every seat still has a stack (${stacks.length} seats)`,
    stacks.length > 0 && stacks.every((chips) => chips !== null && chips >= 0),
  )
  if (stacks.some((chips) => chips === null || chips < 0)) console.log('   ', JSON.stringify(stacks))
}

// The history has to survive four changes of table, because it is the thing
// the whole app is for.
await press(page.getByRole('button', { name: 'Progress', exact: true }))
await page.waitForTimeout(1_500)
const dashboard = (await page.locator('body').innerText()).toLowerCase()
const counted = /([\d,]+) hands?\b/.exec(dashboard)
const reported = counted ? Number(counted[1].replace(/,/g, '')) : null
check(
  `every hand across every table is in the record (${reported} of ${totalPlayed})`,
  reported !== null && reported >= totalPlayed,
)

// Strangers: a table where every style is in the pool and nothing on screen
// says which seat is which. What is being checked is that the game is really
// dealt that way and that nothing leaks the answer.
{
  check('the setup screen opens again', await openSetup())
  check('strangers is an option', await press(page.getByRole('button', { name: /^Strangers/ }), 3_000))
  await page.waitForTimeout(200)
  await press(page.getByRole('button', { name: 'Sit down', exact: true }))
  await page.waitForTimeout(500)

  const tells = ['nit', 'tag', 'lag', 'station', 'maniac', 'rock', 'eagle', 'hawk', 'fish']
  let dealt = 0
  let leaked = null
  for (let hand = 0; hand < 6 && leaked === null; hand++) {
    if ((await playOneHand(hand % 2 === 0)) !== 'done') break
    dealt += 1
    const seats = await page.evaluate(() =>
      [...document.querySelectorAll('[data-seat]')].map((n) => (n.textContent ?? '').toLowerCase()),
    )
    for (const seat of seats) {
      const tell = tells.find((t) => seat.includes(t))
      if (tell) leaked = `${tell} in "${seat.trim().slice(0, 40)}"`
    }
  }

  check(`strangers: ${dealt} hands dealt`, dealt === 6)
  check('strangers: no seat says how it plays', leaked === null)
  if (leaked) console.log('   ', leaked)
}

// A reload has to bring back the table you chose, not the one the app ships
// with — the setup screen is a choice, and a choice that does not survive the
// page being refreshed is a setting nobody made.
await press(page.getByRole('button', { name: 'Table', exact: true }))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1_500)
// Nothing is dealt until you ask for it, so deal one: the seats are what say
// which table came back.
await press(page.locator(DEAL), 15_000)
await page.waitForTimeout(1_200)
const afterReload = await page.evaluate(() => ({
  seats: document.querySelectorAll('[data-seat]').length,
  text: document.body.innerText.slice(0, 400),
}))
check(
  `the table survives a reload (${afterReload.seats} seat plates)`,
  afterReload.seats >= 9,
)
check('and the game is dealt rather than the setup screen', !/choose a table/i.test(afterReload.text))

// And the record survives with it.
await press(page.getByRole('button', { name: 'Progress', exact: true }))
await page.waitForTimeout(3_000)
const reloaded = /([\d,]+) hands?\b/.exec((await page.locator('body').innerText()).toLowerCase())
check(
  `the record survives a reload (${reloaded ? reloaded[1] : 'none'} of ${totalPlayed})`,
  reloaded !== null && Number(reloaded[1].replace(/,/g, '')) >= totalPlayed,
)

check('no console errors', problems.length === 0)
if (problems.length) console.log(problems.slice(0, 10).join('\n'))

await browser.close()
