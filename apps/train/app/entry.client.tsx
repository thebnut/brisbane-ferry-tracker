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

// Register the service worker after load so it never competes with first paint.
const registerServiceWorker = () => {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
}
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Module scripts can run after `load` has already fired (as in apps/bus and apps/ferry).
  if (document.readyState === 'complete') registerServiceWorker()
  else window.addEventListener('load', registerServiceWorker, { once: true })
}
