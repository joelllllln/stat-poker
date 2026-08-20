/**
 * Render the app's mark out to the sizes the platforms ask for.
 *
 * The mark is drawn once, in `art/`, as SVG. Everything in `public/` is
 * generated from it by this script rather than kept by hand, so changing the
 * icon means editing one file and running one command.
 *
 *     node scripts/icons.mjs
 */

import { existsSync, readdirSync, mkdirSync, readFileSync } from 'node:fs'
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

/** Each output: the drawing it comes from, and the size to render it at. */
const OUTPUTS = [
  { from: 'icon.svg', to: 'icon-192.png', width: 192, height: 192 },
  { from: 'icon.svg', to: 'icon-512.png', width: 512, height: 512 },
  { from: 'icon.svg', to: 'apple-touch-icon.png', width: 180, height: 180 },
  { from: 'maskable.svg', to: 'icon-maskable-512.png', width: 512, height: 512 },
  { from: 'social.svg', to: 'social.png', width: 1200, height: 630 },
]

const executablePath = browserPath()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
mkdirSync('public', { recursive: true })

for (const { from, to, width, height } of OUTPUTS) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  })
  // Wrapped in a page rather than opened directly: an SVG opened as a
  // document has no body to style, and the screenshot has to be exactly the
  // icon with nothing around it.
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0;background:#0e0c0a}` +
      `svg{display:block;width:${width}px;height:${height}px}</style>` +
      readFileSync(`art/${from}`, 'utf8'),
  )
  await page.screenshot({ path: `public/${to}`, omitBackground: false })
  await page.close()
  console.log(`public/${to}  ${width}×${height}`)
}

await browser.close()
