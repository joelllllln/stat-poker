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

const after = (await page.locator('body').innerText()).toLowerCase()
check('the hand resolved', /you (won|lost|broke even)/.test(after))
check('session stats appeared', after.includes('your session'))

await page.screenshot({ path: 'screenshot.png', fullPage: true })
check('no console errors', errors.length === 0)
if (errors.length) console.log(errors.slice(0, 5).join('\n'))

await browser.close()
console.log('screenshot written to screenshot.png')
