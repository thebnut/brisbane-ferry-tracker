import { gaSources } from '@bft/ui/analytics-config'

/**
 * Security headers for the ferry Worker, at least as strict as the Vercel deployment's (vercel.json): HSTS, nosniff,
 * Referrer-Policy, Permissions-Policy and a CSP. HTML gets a per-request nonce for React Router's inline hydration
 * scripts, so script-src needs no 'unsafe-inline'. Static assets get the same non-CSP headers from public/_headers.
 * A cutover gate in docs/architecture/cutover-runbook.md verifies these on the live host.
 * Besides GA4 (below), the only external script and frame origin is Cloudflare Turnstile for the feedback sheet, exactly
 * as Cloudflare's Turnstile CSP reference lists (https://developers.cloudflare.com/turnstile/reference/content-security-policy/):
 * script-src and frame-src https://challenges.cloudflare.com. It needs no connect-src.
 * GA4 (only when GA_MEASUREMENT_ID is set, @bft/ui/analytics-config): gtag.js in script-src, and Google Analytics'
 * collection origins in connect-src and img-src. Off in dev and tests, where the policy has no Google origin.
 */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
}

export function contentSecurityPolicy(nonce: string, ga = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${TURNSTILE_ORIGIN}${gaSources(ga, 'script')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://tiles.openfreemap.org${gaSources(ga, 'img')}`,
    "font-src 'self' data:",
    `connect-src 'self' https://tiles.openfreemap.org${gaSources(ga, 'connect')}`,
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

/**
 * Add the base headers to any Worker response, plus the CSP when it's an HTML document. HTML carries a per-request
 * nonce, so a page that set no Cache-Control of its own gets `private, no-store` (never cached or shared), as in the
 * other apps (R8-F1: /privacy, /terms and the 404 page went out with none, so the HTTP cache could keep them).
 */
export function withSecurityHeaders(res: Response, nonce: string, ga = false): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) out.headers.set(k, v)
  if ((out.headers.get('content-type') ?? '').includes('text/html')) {
    out.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce, ga))
    if (!out.headers.has('cache-control')) out.headers.set('cache-control', 'private, no-store')
  }
  return out
}
