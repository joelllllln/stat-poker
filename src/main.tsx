import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Keep the app on the device.
 *
 * Nothing here talks to a server — the hands are in this browser, the coach
 * runs in a worker in this tab — so once the files are cached the whole thing
 * works with the connection off. Registered only in a real build: in
 * development a service worker serving yesterday's bundle is a bug that costs
 * an hour to find.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative, so it registers at whatever path the app is served from and
    // takes that path as its scope.
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // A browser that refuses is a browser that goes online-only, which is
      // how it worked before. Not worth a word to the player.
    })
  })
}
