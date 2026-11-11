import { gaSources } from '@bft/ui/analytics-config'

/**
 * Security headers for the transit Worker, the same pattern as the ferry, train and bus Workers (their
 * workers/security.ts): HSTS, nosniff, Referrer-Policy, Permissions-Policy and a CSP. HTML gets a per-request nonce for
 * React Router's inline hydration scripts and the theme script, so script-src needs no 'unsafe-inline'. Static assets
 * get the same non-CSP headers from public/_headers. External origins: OpenFreeMap (map style, tiles, glyphs, sprites,
 * used by the mounted mode pages' maps) and Cloudflare Turnstile for the Ask box (its script and its challenge iframe,
 * per Cloudflare's Turnstile CSP guidance). Nothing else apart from GA4: the mounted pages read /v1 and /data
 * same-origin, and trip WebSockets are off here (root loader `tripWs: null`). GA4 (only when GA_MEASUREMENT_ID is set,
 * @bft/ui/analytics-config): gtag.js in script-src, and Google Analytics' collection origins in connect-src and
 * img-src. Off in dev and tests, where the policy has no Google origin.
 */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
}

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

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
 * nonce, so a page that set no Cache-Control of its own gets `private, no-store` (never cached or shared).
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

/**
 * The canonical-apex URL for a request to `www.<host of siteUrl>`, else null. Only that one host is redirected, always
 * to the fixed siteUrl origin with the path and query kept, so nothing in the request can pick the target host (no
 * open redirect). A www canonical (the ferry) never matches.
 */
export function wwwRedirectLocation(requestUrl: string, siteUrl: string): string | null {
  let site: URL
  let url: URL
  try {
    site = new URL(siteUrl)
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (site.hostname.startsWith('www.') || url.hostname !== `www.${site.hostname}`) return null
  // pathname always starts with "/", so the result stays on site.origin ("//evil" is a path, not a host).
  return `${site.origin}${url.pathname}${url.search}`
}

/**
 * The standalone apps' page paths without their mode prefix. Links to them (ChatGPT cites `/terminal/south-bank` on
 * this host; the old hosts served them bare) go to the mounted page: one 301, so they never 404 here.
 */
const UNPREFIXED: readonly [RegExp, string][] = [
  [/^\/terminal\/[^/]+$/, '/ferry'],
  [/^\/stations$/, '/train'],
  [/^\/station\/[^/]+$/, '/train'],
  [/^\/stop\/[^/]+$/, '/bus'],
  [/^\/route\/[^/]+$/, '/bus'],
]

/** Never redirected for their path or scheme: the API proxy, client data, fixtures, React Router's own requests. */
const NOT_A_PAGE = /^\/(?:v1|data|api|__fixtures)(?:\/|$)|^\/__|\.data$/

/**
 * The canonical path of a page path, the one in canonicals and the sitemap: no trailing slash on a page (the hubs and
 * `/` keep theirs), the hubs with one, a bare old page under its mode prefix, and a padded bus stop number unpadded
 * (as the stop page's own 301 does). Idempotent, so redirecting to it never loops.
 */
export function canonicalPagePath(pathname: string): string {
  if (pathname === '/') return pathname
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return path
  if (/^\/(?:ferry|train|bus)$/.test(path)) return `${path}/`
  const prefix = UNPREFIXED.find(([re]) => re.test(path))?.[1]
  if (!prefix) return path
  const full = `${prefix}${path}`
  return prefix === '/bus' && /^\/bus\/stop\/0\d{1,5}$/.test(full)
    ? full.replace(/^\/bus\/stop\/0+(?=\d)/, '/bus/stop/')
    : full
}

/**
 * Where a GET or HEAD request to a page should be, or null when it is already there: its canonical path (above), and
 * https on the canonical host (`http://brisbanetransit.com/` was served as is; www already 301s to https). One hop for
 * both. The API, data and fixture paths are never redirected, so a plain-HTTP client of them keeps working. The
 * location is always this origin (or SITE_URL's for the scheme upgrade) plus a path starting with one "/".
 */
export function canonicalLocation(requestUrl: string, siteUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (NOT_A_PAGE.test(url.pathname)) return null
  let site: URL | null = null
  try {
    site = new URL(siteUrl)
  } catch {}
  const upgrade = site?.protocol === 'https:' && url.protocol === 'http:' && url.hostname === site.hostname
  const path = canonicalPagePath(url.pathname)
  if (path === url.pathname && !upgrade) return null
  // A path like "//evil.example" stays a path: it is appended to a fixed origin.
  return `${upgrade && site ? site.origin : url.origin}${path}${url.search}`
}

/**
 * 301 to the canonical apex. Only Worker-handled paths reach this: static files under build/client are answered by
 * Workers static assets on any host, and the pages' canonicals point at the apex.
 */
export function canonicalRedirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location, 'cache-control': 'public, max-age=3600' } })
}

/** Soft launch: until INDEXABLE is "1", every Worker response says noindex (robots.txt disallows all as well). */
export function withRobotsTag(res: Response, indexable: boolean): Response {
  if (!indexable) res.headers.set('X-Robots-Tag', 'noindex')
  return res
}

/** The deploy-wide robots tag withRobotsMeta adds, marked apart from a page's own. */
export const DEPLOY_NOINDEX_META = '<meta name="robots" content="noindex" data-deploy-noindex="">'

/**
 * Any deploy but production (staging, production-preview, local) also says noindex in its HTML, not only in the
 * header, so a copy of a page served or cached without the header stays out of search. Added here as the page streams
 * (HTMLRewriter), so no page's client JavaScript grows for it; React 19 hydration skips an extra tag in <head>. Where
 * HTMLRewriter doesn't exist (unit tests under Node), the response is returned as it is.
 */
export function withRobotsMeta(res: Response, indexable: boolean): Response {
  if (indexable || !(res.headers.get('content-type') ?? '').includes('text/html')) return res
  if (typeof HTMLRewriter === 'undefined') return res
  return new HTMLRewriter()
    .on('head', {
      element(head) {
        head.append(DEPLOY_NOINDEX_META, { html: true })
      },
    })
    .transform(res)
}
