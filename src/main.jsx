import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { cleanupLegacyStorage } from './utils/constants'
import { startEngagedVisit, trackReturnVisit } from './utils/analytics'

// BRI-22: wipe any pre-versioned schedule-cache keys before first render so
// users returning after the cache-shape change don't see stale data.
cleanupLegacyStorage()

// GA4 engaged_visit timer (a no-op wherever public/ga-config.js leaves GA off).
startEngagedVisit()
trackReturnVisit()

// Terminal and 404 pages (scripts/postbuild.mjs) bake a static section into
// #root. Capture it before React replaces #root so App can keep it on the page.
const staticSectionHtml = document.querySelector('#root [data-static-section]')?.outerHTML || null

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App staticSectionHtml={staticSectionHtml} />
    </ErrorBoundary>
  </StrictMode>,
)
