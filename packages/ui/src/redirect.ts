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
  ferry: [/^\/terminal\/[^/]+$/, /^\/trip\/[^/]+$/, /^\/privacy$/, /^\/terms$/],
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
 * The transit path for a mode page: its own page under the mode prefix, `/feedback` and `/whats-new` as they are (shared
 * by every mode), and the mode's transit home for the home page and any unknown path. Null for an excluded path (it isn't redirected).
 */
export function transitPath(mode: RedirectMode, pathname: string): string | null {
  if (isExcludedPath(pathname)) return null
  // One trailing slash is the same page (`/stations/`); the home page is `/`.
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (path === '/feedback' || path === '/whats-new') return path
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

/** Known crawlers and link unfurlers: they get the plain redirect (they hold no favourites). */
const BOT_RE =
  /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|applebot|petalbot|ahrefs|semrush|gptbot|claudebot|bytespider|facebookexternalhit|twitterbot|linkedinbot|discordbot|slackbot|telegrambot|whatsapp|crawler|spider/i

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
  if (env.REDIRECT_TO_TRANSIT !== '1' || !isPageNavigation(request)) return null
  const origin = transitOrigin(env.TRANSIT_SITE_URL)
  if (!origin) return null
  const location = transitLocation(mode, new URL(request.url), origin)
  if (!location) return null
  if (nonce && wantsHandoff(request)) return handoffPage(location, mode, nonce)
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
