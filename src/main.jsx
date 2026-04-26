import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { cleanupLegacyStorage } from './utils/constants'

// BRI-22: wipe any pre-versioned schedule-cache keys before first render so
// users returning after the cache-shape change don't see stale data.
cleanupLegacyStorage()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
