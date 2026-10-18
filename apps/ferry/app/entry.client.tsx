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

// Register the service worker after load so it never competes with first paint. The first page view happens before
// the worker exists, so once it is ready, put this page into the same cache its network-first route uses: an offline
// reload then still opens (with "Offline · scheduled") instead of a browser error.
const PAGES_CACHE = 'ferry-pages'
function registerServiceWorker() {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => caches.open(PAGES_CACHE))
    .then((cache) => cache.add(location.href))
    .catch(() => {})
}
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Module scripts can run after `load` has already fired.
  if (document.readyState === 'complete') registerServiceWorker()
  else window.addEventListener('load', registerServiceWorker, { once: true })
}
