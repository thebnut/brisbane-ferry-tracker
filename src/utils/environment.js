// Runtime / host detection. Pure functions of window.location so they can be
// unit-tested and composed freely. Added in BRI-24 to consolidate scattered
// hostname-substring checks that were breaking Capacitor native builds.

export function isCapacitor() {
  const p = window.location.protocol;
  return p === 'capacitor:' || p === 'ionic:';
}

export function isLocalDev() {
  // Capacitor also reports hostname === 'localhost' — must short-circuit first.
  return !isCapacitor() && window.location.hostname === 'localhost';
}

export function isVercelPreview() {
  return window.location.hostname.endsWith('.vercel.app');
}

export function isGitHubPages() {
  return window.location.hostname.includes('github.io');
}

export function isVercelProduction() {
  const h = window.location.hostname;
  return h === 'brisbaneferry.com'
      || h === 'www.brisbaneferry.com'
      || h === 'ferry.lifemap.au';
}

export function isDebugHost() {
  return isLocalDev()
      || window.location.hostname === '127.0.0.1'
      || isVercelPreview()
      || isVercelProduction();
}

// BRI-35: use the `www.` canonical host directly. The apex `brisbaneferry.com`
// serves a Vercel edge 307 → `www.brisbaneferry.com`, and that redirect has no
// CORS headers (it happens before the application runs applyCors()). Browsers
// in cross-origin CORS mode reject redirects missing Access-Control-Allow-Origin,
// so the app-side fetch silently fails. Pointing at `www.` directly avoids the
// redirect hop and the request completes in one round trip.
const CAPACITOR_API_ORIGIN = 'https://www.brisbaneferry.com';
const GITHUB_SCHEDULE_URL =
  'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/latest.json';
const LOCAL_SCHEDULE_URL = '/schedule-data/latest.json';

// Base URL for /api/* calls. Web stays same-origin (''); Capacitor needs an
// absolute URL because capacitor://localhost has no Vercel serverless proxy.
// Pair with a Capacitor-origin CORS allowlist (tracked separately).
export function getApiBase() {
  return isCapacitor() ? CAPACITOR_API_ORIGIN : '';
}

// Default URL for the pre-processed schedule JSON. Local dev serves it from
// Vite's public/ so contributors can iterate offline; everywhere else (including
// Capacitor) reads from the GitHub Pages copy.
export function getScheduleDataUrl({ forceGitHub = false } = {}) {
  return !forceGitHub && isLocalDev() ? LOCAL_SCHEDULE_URL : GITHUB_SCHEDULE_URL;
}
