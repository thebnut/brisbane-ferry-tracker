/**
 * Security headers for the train Worker, the same pattern as the ferry Worker (apps/ferry/workers/security.ts): HSTS,
 * nosniff, Referrer-Policy, Permissions-Policy and a CSP. HTML gets a per-request nonce for React Router's inline
 * hydration scripts and the theme script, so script-src needs no 'unsafe-inline'. Static assets get the same non-CSP
 * headers from public/_headers. External origins: OpenFreeMap (map style, tiles, glyphs, sprites) and, only when
 * API_WS_BASE points trip WebSockets at another host, that host's wss:// origin. Same-origin sockets are 'self'.
 */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
}

export function contentSecurityPolicy(nonce: string, wsOrigin: string | null = null): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "font-src 'self' data:",
    `connect-src 'self' https://tiles.openfreemap.org${wsOrigin ? ` ${wsOrigin}` : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/** The wss:// origin of API_WS_BASE, or null when trip sockets are same-origin (empty) or the value isn't wss://. */
export function wsOriginOf(base: string | undefined): string | null {
  if (!base) return null
  try {
    const url = new URL(base)
    return url.protocol === 'wss:' ? url.origin : null
  } catch {
    return null
  }
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/** Add the base headers to any Worker response, plus the CSP when it's an HTML document. */
export function withSecurityHeaders(res: Response, nonce: string, wsOrigin: string | null = null): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) out.headers.set(k, v)
  if ((out.headers.get('content-type') ?? '').includes('text/html'))
    out.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce, wsOrigin))
  return out
}
