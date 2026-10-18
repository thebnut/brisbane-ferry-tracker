/**
 * Security headers for the transit Worker, the same pattern as the ferry, train and bus Workers (their
 * workers/security.ts): HSTS, nosniff, Referrer-Policy, Permissions-Policy and a CSP. HTML gets a per-request nonce for
 * React Router's inline hydration scripts and the theme script, so script-src needs no 'unsafe-inline'. Static assets
 * get the same non-CSP headers from public/_headers. External origins: OpenFreeMap (map style, tiles, glyphs, sprites,
 * used by the mounted mode pages' maps) and Cloudflare Turnstile for the Ask box (its script and its challenge iframe,
 * per Cloudflare's Turnstile CSP guidance). Nothing else: the mounted pages read /v1 and /data same-origin, and trip
 * WebSockets are off here (root loader `tripWs: null`).
 */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
}

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "font-src 'self' data:",
    "connect-src 'self' https://tiles.openfreemap.org",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/** Add the base headers to any Worker response, plus the CSP when it's an HTML document. */
export function withSecurityHeaders(res: Response, nonce: string): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) out.headers.set(k, v)
  if ((out.headers.get('content-type') ?? '').includes('text/html'))
    out.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce))
  return out
}
