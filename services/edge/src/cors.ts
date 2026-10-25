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

// /mcp only: a local developer tool such as the MCP Inspector (any port).
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * /mcp's Origin rule (the MCP transport's DNS-rebinding check), which its CORS follows too: no Origin (native and
 * server-side MCP clients), an origin the API allows, or a local developer tool. Every other path keeps the legacy
 * allowlist exactly.
 */
export function mcpOriginAllowed(origin: string | null | undefined, allowAll: boolean): boolean {
  return origin == null || allowAll || isAllowedOrigin(origin) || LOCAL_DEV_ORIGIN.test(origin)
}

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
  } else if (
    isAllowedOrigin(origin) ||
    (path === '/mcp' && origin != null && mcpOriginAllowed(origin, false))
  ) {
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
