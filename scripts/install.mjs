/**
 * Does it install, and does it run with the connection off?
 *
 * Two claims that are easy to make in a manifest and easy to get wrong: that
 * the browser can install this as an app, and that once installed it works on
 * a train. Both are checked against a real browser rather than against the
 * files that are supposed to cause them.
 *
 *     npx vite build && npx vite preview --port 4173 &
 *     node scripts/install.mjs
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

const SITE = process.env.INSTALL_URL ?? 'http://localhost:4173'
const executablePath = browserPath()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) problems.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`page: ${String(e)}`))

const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) process.exitCode = 1
}

await page.goto(SITE, { waitUntil: 'networkidle' })

// What the browser reads to decide whether this is an app.
const head = await page.evaluate(() => ({
  title: document.title,
  description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
  themeColour: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
  manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '',
  appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? '',
  icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '',
  ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
}))

check(`it has a real name ("${head.title}")`, /stat poker/i.test(head.title) && head.title.length > 12)
check('it says what it is', head.description.length > 40)
check('the browser chrome matches the table', head.themeColour === '#0e0c0a')
check('it declares a manifest', head.manifest.endsWith('manifest.webmanifest'))
check('it has an icon for a home screen', head.appleIcon.endsWith('apple-touch-icon.png'))
check('it has an icon for a tab', head.icon.endsWith('favicon.svg'))
check('a shared link has a picture', head.ogImage.endsWith('social.png'))

// The manifest itself, and every file it promises.
const manifest = await page.evaluate(async (href) => {
  const response = await fetch(href)
  return response.ok ? await response.json() : null
}, head.manifest)

check('the manifest parses', manifest !== null)
if (manifest) {
  check(`it installs as "${manifest.name}"`, typeof manifest.name === 'string' && manifest.name.length > 0)
  check('it opens without browser chrome', manifest.display === 'standalone')
  check('it starts where it is served from', manifest.start_url === '.')
  check('it paints the right colour while it loads', manifest.background_color === '#0e0c0a')

  const sizes = (manifest.icons ?? []).map((i) => i.sizes)
  check('it has a 192 and a 512 icon', sizes.includes('192x192') && sizes.includes('512x512'))
  check(
    'it has a maskable icon, so Android does not put it in a white box',
    (manifest.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable')),
  )

  const missing = []
  for (const icon of manifest.icons ?? []) {
    const url = new URL(icon.src, new URL(head.manifest, page.url())).href
    const ok = await page.evaluate(async (u) => (await fetch(u)).ok, url)
    if (!ok) missing.push(icon.src)
  }
  check(`every icon it promises is there (${(manifest.icons ?? []).length})`, missing.length === 0)
  if (missing.length) console.log('   missing:', missing.join(', '))
}

// The service worker has to be running before anything can be said about
// working offline.
const registered = await page.evaluate(async () => {
  const worker = await navigator.serviceWorker.ready.catch(() => null)
  return worker !== null && worker.active !== null
})
check('a service worker is running', registered)

// Now pull the plug.
const sitDown = page.getByRole('button', { name: 'Sit down', exact: true })
if ((await sitDown.count()) > 0) await sitDown.first().click()
await page.waitForTimeout(500)

await context.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(1_500)

const offline = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 400),
  buttons: [...document.querySelectorAll('button')].length,
}))
check('it still loads with the connection off', /stat\s*poker/i.test(offline.text))
check('and it is the game, not an error page', offline.buttons >= 3)

// And it is still playable, not just painted.
const dealt = await page
  .locator('button:has-text("Deal"):not([disabled])')
  .first()
  .click({ timeout: 10_000 })
  .then(() => true)
  .catch(() => false)
await page.waitForTimeout(1_500)
const playing = await page.evaluate(() => document.querySelectorAll('[data-seat]').length)
check('a hand can be dealt offline', dealt && playing > 0)

await context.setOffline(false)
check('no console errors', problems.length === 0)
if (problems.length) console.log(problems.slice(0, 8).join('\n'))

await browser.close()
