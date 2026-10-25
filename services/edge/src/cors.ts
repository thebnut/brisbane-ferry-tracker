/**
 * CORS, ported line for line from the legacy `api/_cors.js` (BRI-20, BRI-25) so the Phase 2 cutover is a no-op
 * for every existing client: the same allowlist, Vercel preview pattern, `CORS_ALLOW_ALL` break-glass, and the
 * same Allow-Credentials / Methods / Headers on every response.
 */
import type { Logger } from './log.ts'

const STATIC_ALLOWED = new Set([
  'https://brisbaneferry.com',
  'https://www.brisbaneferry.com',
  'https://ferry.lifemap.au',
  'https://www.ferry.lifemap.au',
  'http://localhost:5173',
  'http://localhost:4173',
  // BRI-25: Capacitor mobile wrappers. These schemes can only be produced by the iOS/Android WebView.
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
])

// Vercel preview deploys: brisbane-ferry-tracker-<hash>-starblaze.vercel.app, -git-<branch>-starblaze.vercel.app
const VERCEL_PREVIEW_RE = /^https:\/\/brisbane-ferry-tracker(-[a-z0-9-]+)?-starblaze\.vercel\.app$/

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin || typeof origin !== 'string') return false
  if (STATIC_ALLOWED.has(origin)) return true
  return VERCEL_PREVIEW_RE.test(origin)
}

export function corsHeaders(
  origin: string | null | undefined,
  allowAll: boolean,
  log?: Logger,
  path?: string,
): Record<string, string> {
  const h: Record<string, string> = {}
  if (allowAll) {
    h['Access-Control-Allow-Origin'] = '*'
  } else if (isAllowedOrigin(origin)) {
    h['Access-Control-Allow-Origin'] = origin as string
    h.Vary = 'Origin'
  } else if (origin) {
    log?.warn('[cors] blocked origin', { origin, path })
  }
  h['Access-Control-Allow-Credentials'] = 'true'
  h['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
  h['Access-Control-Allow-Headers'] =
    `X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-BFT-Client${
      // The MCP transport header, on /mcp only: every other path keeps the legacy list exactly.
      path === '/mcp' ? ', MCP-Protocol-Version' : ''
    }`
  return h
}
