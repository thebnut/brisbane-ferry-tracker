/**
 * P6: the mode hosts (ferry, train, bus) send page navigations to the same page on BrisbaneTransit, which mounts every
 * mode page under its prefix (apps/transit/app/routes.ts). Worker code only: imported by the mode Workers, never by a
 * client bundle.
 *
 * Off unless REDIRECT_TO_TRANSIT is "1". The Location is always the configured TRANSIT_SITE_URL's origin plus a path
 * built here from a fixed prefix and the matched route segments, so a request can't steer it to another host.
 */

export type RedirectMode = 'ferry' | 'train' | 'bus'

export interface RedirectEnv {
  REDIRECT_TO_TRANSIT?: string
  /** "301" once a mapping is verified; anything else (or unset) is a 302. */
  REDIRECT_STATUS?: string
  TRANSIT_SITE_URL?: string
}

/** Each mode's pages, as `routes.ts` declares them (`*` excluded): matched against the request path. */
const PAGES: Record<RedirectMode, readonly RegExp[]> = {
  ferry: [/^\/terminal\/[^/]+$/, /^\/privacy$/, /^\/terms$/],
  train: [/^\/stations$/, /^\/station\/[^/]+$/, /^\/trip\/[^/]+$/, /^\/map$/, /^\/alerts$/],
  bus: [
    /^\/nearby$/,
    /^\/stop\/[^/]+$/,
    /^\/trip\/[^/]+$/,
    /^\/route\/[^/]+$/,
    /^\/map$/,
    /^\/alerts$/,
    /^\/about$/,
  ],
}

/** Paths that keep being served by the mode host: APIs, data, SEO files, the PWA's files and anything static. */
const EXCLUDED_PREFIXES = ['/v1/', '/api/', '/data/', '/assets/', '/sitemaps/', '/__']
const EXCLUDED_PATHS = new Set([
  '/v1',
  '/api',
  '/data',
  '/sitemap.xml',
  '/robots.txt',
  '/sw.js',
  '/manifest.webmanifest',
])
/** A file name, not a page (also React Router's `.data` single-fetch requests from an already open, old shell). */
const STATIC_FILE_RE =
  /\.(?:avif|css|data|gif|html?|ico|jpe?g|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff2?|xml)$/i

export function isExcludedPath(pathname: string): boolean {
  return (
    EXCLUDED_PATHS.has(pathname) ||
    EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p)) ||
    STATIC_FILE_RE.test(pathname)
  )
}

/**
 * The transit path for a mode page: its own page under the mode prefix, `/feedback` for feedback, and the mode's
 * transit home for the home page and any unknown path. Null for an excluded path (it isn't redirected).
 */
export function transitPath(mode: RedirectMode, pathname: string): string | null {
  if (isExcludedPath(pathname)) return null
  // One trailing slash is the same page (`/stations/`); the home page is `/`.
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (path === '/feedback') return '/feedback'
  const home = `/${mode}`
  return PAGES[mode].some((re) => re.test(path)) ? `${home}${path}` : home
}

/** The configured transit origin, or null when it is missing or not an http(s) URL (then nothing is redirected). */
export function transitOrigin(base: string | undefined): string | null {
  if (!base) return null
  try {
    const u = new URL(base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/** The full transit URL for a request URL, always on `origin`. */
export function transitLocation(mode: RedirectMode, url: URL, origin: string): string | null {
  const path = transitPath(mode, url.pathname)
  if (path === null) return null
  const location = `${origin}${path}${url.search}`
  // Belt and braces: the path always starts with a fixed single-slash prefix, so this can't change host.
  return new URL(location).origin === origin ? location : null
}

/** A GET/HEAD page navigation (fetch(), images and other subresource requests carry a different Sec-Fetch-Mode). */
export function isPageNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  // A WebSocket (or any other) upgrade is never a page, whatever its path.
  if (request.headers.has('upgrade')) return false
  const mode = request.headers.get('sec-fetch-mode')
  return mode === null || mode === 'navigate'
}

export function redirectStatus(env: RedirectEnv): 301 | 302 {
  return env.REDIRECT_STATUS === '301' ? 301 : 302
}

/** The redirect for this request, or null to serve it as before (flag off, not a page navigation, or excluded). */
export function transitRedirect(request: Request, mode: RedirectMode, env: RedirectEnv): Response | null {
  if (env.REDIRECT_TO_TRANSIT !== '1' || !isPageNavigation(request)) return null
  const origin = transitOrigin(env.TRANSIT_SITE_URL)
  if (!origin) return null
  const location = transitLocation(mode, new URL(request.url), origin)
  if (!location) return null
  const status = redirectStatus(env)
  return new Response(null, {
    status,
    headers: {
      location,
      // A 302 is the staging trial: never cached, so changing a mapping takes effect at once.
      'cache-control': status === 301 ? 'public, max-age=86400' : 'no-store',
    },
  })
}
