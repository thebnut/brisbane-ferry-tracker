/**
 * P6: the mode hosts (ferry, train, bus) send page navigations to the same page on BrisbaneTransit, which mounts every
 * mode page under its prefix (apps/transit/app/routes.ts). Worker code only: imported by the mode Workers, never by a
 * client bundle.
 *
 * Off unless REDIRECT_TO_TRANSIT is "1". The Location is always the configured TRANSIT_SITE_URL's origin plus a path
 * built here from a fixed prefix and the matched route segments, so a request can't steer it to another host.
 */

import {
  BUS_ID_RE,
  BUS_NAME_MAX,
  CONTROL_CHARS_RE,
  FERRY_ID_RE,
  FERRY_NAME_MAX,
  HANDOFF_PREFIX,
  MAX_BUS,
  MAX_HANDOFF_BYTES,
  MAX_TRAIN,
  TRAIN_KEY_RE,
} from './handoff-codec.ts'

export type RedirectMode = 'ferry' | 'train' | 'bus'

export interface RedirectEnv {
  REDIRECT_TO_TRANSIT?: string
  /** "301" once a mapping is verified; anything else (or unset) is a 302. */
  REDIRECT_STATUS?: string
  TRANSIT_SITE_URL?: string
}

/** Each mode's pages, as `routes.ts` declares them (`*` excluded): matched against the request path. */
const PAGES: Record<RedirectMode, readonly RegExp[]> = {
  ferry: [/^\/terminal\/[^/]+$/, /^\/trip\/[^/]+$/, /^\/map$/, /^\/privacy$/, /^\/terms$/],
  train: [/^\/stations$/, /^\/station\/[^/]+$/, /^\/trip\/[^/]+$/, /^\/map$/, /^\/alerts$/],
  bus: [
    /^\/nearby$/,
    /^\/stop\/[^/]+$/,
    /^\/trip\/[^/]+$/,
    /^\/route\/[^/]+$/,
    /^\/stops(?:\/[^/]+){0,2}$/,
    /^\/map$/,
    /^\/alerts$/,
    /^\/about$/,
  ],
}

/**
 * Paths that are never a page: APIs, data, SEO files, the PWA's files and anything static. They keep being served by
 * the mode host, except robots.txt, llms.txt and the sitemaps, which go to transit's own (seoFilePath).
 */
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
 * The site-wide SEO files of an old mode host and their one transit equivalent: robots.txt, llms.txt, and every
 * sitemap (the index and its child files) to transit's sitemap index, as the legacy ferry hosts do (vercel.json).
 */
export function seoFilePath(pathname: string): string | null {
  if (pathname === '/robots.txt' || pathname === '/llms.txt') return pathname
  if (pathname === '/sitemap.xml' || /^\/sitemaps\/[^/]+\.xml$/.test(pathname)) return '/sitemap.xml'
  return null
}

/** A bus stop number shared with its leading zeros (`/stop/010813`) is the unpadded stop_id's page (`/stop/10813`). */
const unpadStop = (path: string) =>
  // The bus app's canonicalStopId: a 2–6 digit number with a leading zero loses its leading zeros.
  /^\/stop\/0\d{1,5}$/.test(path) ? path.replace(/^\/stop\/0+(?=\d)/, '/stop/') : path

/**
 * The stop directory's canonical spelling, as the bus app's parseDirectoryParams 301s to: a lower-case letter group,
 * a page number without leading zeros and page 1 as the bare letter (`/stops/B/1` → `/stops/b`, `/stops/b/02` →
 * `/stops/b/2`). Kept here, not imported, so this package never depends on an app. A path the directory would 404 is
 * left as it is (transit 404s it), so this never invents a page. apps/bus/test/redirect.test.ts checks it agrees.
 */
export function directoryCanonical(path: string): string {
  const m = /^\/stops\/([^/]+)(?:\/([^/]+))?$/.exec(path)
  if (!m?.[1]) return path
  const letter = m[1].toLowerCase()
  const pageParam = m[2]
  if (!/^(?:[a-z]|0-9)$/.test(letter)) return path
  if (pageParam === undefined) return `/stops/${letter}`
  if (!/^\d{1,4}$/.test(pageParam)) return path
  const page = Number(pageParam)
  if (page < 1) return path
  return page === 1 ? `/stops/${letter}` : `/stops/${letter}/${page}`
}

/**
 * The path on the mode host without the mode's own prefix: old URLs that already carry it (`/train/station/central`,
 * the ferry app's `/ferry/terminal/x` base) are the same page as the bare one, so the prefix is never added twice.
 */
function withoutModePrefix(mode: RedirectMode, path: string): string {
  const prefix = `/${mode}`
  if (path === prefix) return '/'
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path
}

/**
 * The transit path for a mode page: its own page under the mode prefix, `/feedback` and `/whats-new` as they are (shared
 * by every mode), and the mode's transit home (`/<mode>/`, its canonical) for the home page and any unknown path. A
 * path that already starts with the mode prefix keeps a single one. Null for an excluded path (it isn't redirected).
 */
export function transitPath(mode: RedirectMode, pathname: string): string | null {
  if (isExcludedPath(pathname)) return null
  // One trailing slash is the same page (`/stations/`); the home page is `/`.
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const bare = withoutModePrefix(mode, trimmed)
  if (bare === '/feedback' || bare === '/whats-new') return bare
  // One hop to the canonical stop or directory page: transit would 301 a padded stop number or an odd spelling again.
  const path = mode === 'bus' ? directoryCanonical(unpadStop(bare)) : bare
  const prefix = `/${mode}`
  return PAGES[mode].some((re) => re.test(path)) ? `${prefix}${path}` : `${prefix}/`
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

/** A 3xx: what the permanent move exempts from the soft launch's noindex. */
export const isRedirect = (status: number) => status >= 300 && status < 400

/**
 * The permanent move (release 24, production): REDIRECT_TO_TRANSIT on with 301s. Crawlers must reach the 301s to move
 * the pages' standing to transit, so the mode host's robots.txt lets them in and its redirects carry no noindex. The
 * staging trial (302) stays out of search as before.
 */
export function movedPermanently(env: RedirectEnv): boolean {
  return env.REDIRECT_TO_TRANSIT === '1' && redirectStatus(env) === 301
}

/**
 * The response for a request to the www host while the pages are moving: the transit redirect itself (one hop, never
 * via the apex), or null for anything not redirected (static files, APIs), which keeps the www → apex 301. No handoff
 * page: www always 301'd to the apex, so its storage holds no favourites.
 */
export function wwwTransitRedirect(request: Request, mode: RedirectMode, env: RedirectEnv): Response | null {
  return env.REDIRECT_TO_TRANSIT === '1' ? transitRedirect(request, mode, env) : null
}

/**
 * Set by the handoff page when this origin has no favourites to hand over, so later navigations get the plain
 * redirect. Per mode host. While there are favourites, every browser navigation hands them over again: this host
 * can't know whether transit stored them (a full store, storage errors), and transit's import is idempotent (it keeps
 * a ledger of what it has stored, so a stop removed there isn't added back).
 */
export const HANDOFF_COOKIE = 'bft-handoff'
/**
 * The bus handoff page's place in a list too long for one fragment: a cookie on this origin, so it is kept even when
 * localStorage is full.
 */
export const HANDOFF_NEXT_COOKIE = 'bft-handoff-next'

/**
 * Known crawlers, fetchers and link unfurlers: they get the plain redirect (they hold no favourites). Google's other
 * agents matter as much as Googlebot: Search Console's URL Inspection (Google-InspectionTool), GoogleOther, AdsBot and
 * Storebot were given the noindex handoff page, which read as "excluded by noindex" there. So were the AI assistants'
 * on-demand fetchers (ChatGPT-User, OAI-SearchBot, Perplexity-User, Claude-User), which follow cited links.
 */
export const BOT_RE =
  /googlebot|google-inspectiontool|googleother|google-extended|adsbot-google|storebot-google|mediapartners-google|feedfetcher-google|apis-google|google-read-aloud|bingbot|bingpreview|adidxbot|msnbot|yandex|baiduspider|duckduckbot|duckassistbot|slurp|applebot|petalbot|ahrefs|semrush|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|perplexitybot|perplexity-user|amazonbot|ccbot|meta-externalagent|meta-externalfetcher|bytespider|facebookexternalhit|twitterbot|linkedinbot|discordbot|slackbot|telegrambot|whatsapp|crawler|spider/i

export function hasHandoffCookie(header: string | null): boolean {
  return (header ?? '').split(';').some((c) => c.trim() === `${HANDOFF_COOKIE}=1`)
}

/**
 * P6b: whether this navigation gets the handoff page (it may hold favourites on this origin) rather than the plain
 * redirect: a browser's GET page load (Fetch Metadata navigate, or no Fetch Metadata but asking for HTML), not yet
 * handed off, not a known crawler. curl, HEAD and bots get the redirect status.
 */
export function wantsHandoff(request: Request): boolean {
  if (request.method !== 'GET' || hasHandoffCookie(request.headers.get('cookie'))) return false
  const ua = request.headers.get('user-agent') ?? ''
  if (!ua || BOT_RE.test(ua)) return false
  const fetchMode = request.headers.get('sec-fetch-mode')
  if (fetchMode === 'navigate') return true
  return fetchMode === null && (request.headers.get('accept') ?? '').includes('text/html')
}

const BRAND: Record<RedirectMode, string> = {
  ferry: 'Brisbane Ferry',
  train: 'BrisbaneTrain',
  bus: 'BrisbaneBus',
}

/**
 * Each mode's favourites reader, as plain browser JS: reads only that store's key(s), keeps only items in the shapes
 * handoff-codec.ts accepts, sets `d.<mode>` and `n`. Uses `g` (JSON from storage), `t` (text check) and `ls`.
 */
const READERS: Record<RedirectMode, string> = {
  ferry: `var p=g(ls,"brisbane-ferry-selected-stops"),r=!!p;if(!p){try{p=g(sessionStorage,"brisbane-ferry-selected-stops-session")}catch(e){bad=1}}
function s(x){return x&&(typeof x.id==="string"||typeof x.id==="number")&&${FERRY_ID_RE}.test(String(x.id))?{id:String(x.id),name:t(x.name,${FERRY_NAME_MAX})?x.name:""}:null}
var o=p&&s(p.outbound),i=p&&s(p.inbound);if(o&&i&&o.id!==i.id){d.ferry={pair:{outbound:o,inbound:i},remember:r};n=1}`,
  train: `var f=g(ls,"bft-train-favourites"),o=[],K=${TRAIN_KEY_RE};
if(Array.isArray(f))for(var j=0;j<f.length&&o.length<${MAX_TRAIN};j++){var x=f[j];if(x&&typeof x.from==="string"&&K.test(x.from)&&(x.to==null||(typeof x.to==="string"&&K.test(x.to))))o.push({from:x.from,to:x.to==null?null:x.to})}
if(o.length){d.train=o;n=o.length}`,
  // The bus app has no cap on saved stops: a list too long for one fragment goes over in turns, starting where the
  // last handoff stopped (the bft-handoff-next cookie), so every stop moves across visits.
  bus: `var b=g(ls,"bft-bus-saved"),o=[],F=0,T=0;
if(Array.isArray(b))for(var j=0;j<b.length;j++){var x=b[j];if(x&&typeof x.id==="string"&&${BUS_ID_RE}.test(x.id)&&t(x.name,${BUS_NAME_MAX})&&x.name)o.push({id:x.id,name:x.name})}
T=o.length;F=Number((document.cookie.match(/(?:^|; )${HANDOFF_NEXT_COOKIE}=(\\d+)/)||[])[1])||0;if(F>=T)F=0;o=o.slice(F).concat(o.slice(0,F)).slice(0,${MAX_BUS});
if(o.length){d.bus=o;n=o.length}`,
}

/**
 * The handoff page's script, static per mode (nothing from the request): read this origin's favourites, put them in
 * the fragment of the link the server rendered (a bus list longer than the size cap goes over in turns), and go. Only
 * when it has read this origin's storage without error and found nothing to hand over does it set the handed-off
 * cookie. Any failure still goes to the plain link.
 */
export function handoffScript(mode: RedirectMode): string {
  return `(function(){var a=document.getElementById("bft-go"),u=a.href,d={v:1},n=0,ok=0,bad=0;
try{var ls=window.localStorage,C=${CONTROL_CHARS_RE};
function g(st,k){var v;try{v=st.getItem(k)}catch(e){bad=1;return null}try{return JSON.parse(v||"null")}catch(e){return null}}
function t(x,m){return typeof x==="string"&&x.length<=m&&!C.test(x)}
function enc(v){var y=new TextEncoder().encode(JSON.stringify(v));if(y.length>${MAX_HANDOFF_BYTES})return null;var z="";for(var q=0;q<y.length;q++)z+=String.fromCharCode(y[q]);return btoa(z).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}
${READERS[mode]}
ok=1;if(n){var l=d.bus||d.train,e=enc(d);while(e===null&&l&&l.length>1){l.pop();e=enc(d)}if(e){u+="${HANDOFF_PREFIX}"+e;if(d.bus)document.cookie="${HANDOFF_NEXT_COOKIE}="+(F+d.bus.length)%T+"; Max-Age=31536000; Path=/; Secure; SameSite=Lax"}}}catch(e){}
if(ok&&!bad&&!n)try{document.cookie="${HANDOFF_COOKIE}=1; Max-Age=31536000; Path=/; Secure; SameSite=Lax"}catch(e){}
location.replace(u)})()`
}

/**
 * Release 24: the legacy Brisbane Ferry site (www.brisbaneferry.com, Vercel) moves to BrisbaneTransit's Ferry tab. Its
 * edge 301s (vercel.json) go to crawlers, scripts and browsers already handed off (the bft-handoff cookie); any other
 * browser's first visit loads the legacy page, whose first script (public/handoff-ferry.js, this output) hands the
 * remembered pair over with the ferry reader above, then leaves for the same transit page as the 301 would. Static
 * (served as a file, so the legacy CSP's script-src 'self' allows it); a no-op on any other host (the iOS app, previews).
 */
export function legacyFerryHandoffJs(transitOrigin: string): string {
  const origin = JSON.stringify(transitOrigin)
  return `/* Generated by legacyFerryHandoffJs (packages/ui/src/redirect.ts); apps/transit/test/legacy-ferry-handoff.test.ts checks this file. Do not edit. */
if(/^(www\\.)?brisbaneferry\\.com$/.test(location.hostname)){(function(){var m=/^\\/terminal\\/([a-z0-9-]+)(?:\\/(?:index\\.html)?)?$/.exec(location.pathname),a=document.createElement("a");
a.id="bft-go";a.href=${origin}+(m?"/ferry/terminal/"+m[1]:"/ferry/")+location.search;document.head.appendChild(a)})();
${handoffScript('ferry')}}
`
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')

/**
 * The tiny page a browser gets instead of the redirect on its first visit after the move: its script hands the
 * favourites over. Without JavaScript, the noscript refresh and the link still reach the transit page.
 */
export function handoffPage(location: string, mode: RedirectMode, nonce: string): Response {
  const href = escapeHtml(location)
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${BRAND[mode]} is now part of BrisbaneTransit</title><noscript><meta http-equiv="refresh" content="0;url=${href}"></noscript></head><body><p>${BRAND[mode]} is now part of BrisbaneTransit. <a id="bft-go" href="${href}">Continue to BrisbaneTransit</a></p><script nonce="${escapeHtml(nonce)}">${handoffScript(mode)}</script></body></html>`
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  })
}

/**
 * The response for this request, or null to serve it as before (flag off, not a page navigation, or excluded): the
 * handoff page for a browser's first visit (P6b, needs the page's CSP nonce), else the redirect.
 */
export function transitRedirect(
  request: Request,
  mode: RedirectMode,
  env: RedirectEnv,
  nonce?: string,
): Response | null {
  if (env.REDIRECT_TO_TRANSIT !== '1') return null
  const origin = transitOrigin(env.TRANSIT_SITE_URL)
  if (!origin) return null
  const url = new URL(request.url)
  const seo = seoFilePath(url.pathname)
  let location: string | null
  if (seo) {
    // robots.txt, llms.txt and the sitemaps: to transit's own, never a handoff page. Fetched by crawlers without
    // Fetch Metadata, so no navigation check (only GET/HEAD).
    if (request.method !== 'GET' && request.method !== 'HEAD') return null
    location = `${origin}${seo}`
  } else {
    if (!isPageNavigation(request)) return null
    location = transitLocation(mode, url, origin)
    if (!location) return null
    if (nonce && wantsHandoff(request)) return handoffPage(location, mode, nonce)
  }
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
