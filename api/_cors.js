// Shared CORS helper for API handlers.
//
// Vercel treats filenames prefixed with `_` inside /api/ as non-endpoints, so
// this module is safely importable from handlers without exposing a route.
//
// BRI-20 (2026-04-17): tightened from wildcard `Access-Control-Allow-Origin: *`
// to a dynamic allowlist. Includes a `CORS_ALLOW_ALL` env-var break-glass so
// the tightening can be reverted instantly in Vercel dashboard without a code
// deploy if a legitimate origin is unexpectedly blocked.

const STATIC_ALLOWED = new Set([
  'https://brisbaneferry.com',
  'https://www.brisbaneferry.com',
  'https://ferry.lifemap.au',
  'https://www.ferry.lifemap.au',
  'http://localhost:5173',
  'http://localhost:4173',
  // BRI-25: Capacitor mobile wrappers. These schemes can only be produced by
  // the iOS/Android WebView — a browser page cannot forge them as an Origin.
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
]);

// Vercel preview deploys follow these URL patterns:
//   https://brisbane-ferry-tracker-<hash>-starblaze.vercel.app
//   https://brisbane-ferry-tracker-git-<branch>-starblaze.vercel.app
const VERCEL_PREVIEW_RE = /^https:\/\/brisbane-ferry-tracker(-[a-z0-9-]+)?-starblaze\.vercel\.app$/;

export function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  if (STATIC_ALLOWED.has(origin)) return true;
  return VERCEL_PREVIEW_RE.test(origin);
}

/**
 * Apply CORS headers to the response.
 *
 * - If CORS_ALLOW_ALL=true: falls back to wildcard `*` (rollback mode).
 * - If origin is in the allowlist: echoes it back with `Vary: Origin`.
 * - If origin is present but not allowlisted: logs a warning and omits the
 *   Allow-Origin header — browser will block the request.
 * - If origin is absent (same-origin, curl, etc.): sets no Allow-Origin.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export function applyCors(req, res) {
  const origin = req.headers?.origin;
  const allowAll = process.env.CORS_ALLOW_ALL === 'true';

  if (allowAll) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    // Log blocked origins during rollout so we can catch any legitimate origin
    // we forgot to allowlist. Appears in Vercel function logs as a warning.
    console.warn(`[cors] blocked origin: ${origin} on ${req.url}`);
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );
}
