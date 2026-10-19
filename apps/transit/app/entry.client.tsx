import { savePageCopy } from '@bft/ui/connectivity'
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  )
})

// Register the service worker after load so it never competes with first paint. Once it is ready, put this page into
// the cache its network-first route uses, so an offline reload still opens (Saved then shows "Offline · scheduled").
const PAGES_CACHE = 'transit-pages'
function registerServiceWorker() {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    // Never a demo page (DEMO_HEADER, R7-B1).
    .then(() => savePageCopy(PAGES_CACHE, location.href))
    .catch(() => {})
}
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Module scripts can run after `load` has already fired.
  if (document.readyState === 'complete') registerServiceWorker()
  else window.addEventListener('load', registerServiceWorker, { once: true })
}
