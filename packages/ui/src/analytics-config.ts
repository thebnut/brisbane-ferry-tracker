/**
 * GA4 for the four Worker apps, server side: whether it's on, the CSP origins it needs and the inline bootstrap the
 * root renders. Only root loaders and workers/security.ts import this, so none of it reaches the browser bundle.
 *
 * The event contract (shared with the legacy src/ app, ga-legacy):
 *  - one property, cross-domain over the four sites (GA matches subdomains, so www. and next. are covered);
 *  - `site_mode` (ferry, bus, train or transit: the site, not the board) in config and on every event;
 *  - `page_view` sent by /ga.js (send_page_view off), once on load and on each client route change;
 *  - `engaged_visit` and `return_visit` (analytics-run.ts) and `save_stop` (`window.__bftGa.saveStop`, defined by the
 *    bootstrap);
 *  - no Google signals or ad personalisation, no user ids, no location, no search text;
 *  - `page_title` built from the path (gaPageTitle: mode, page type and the public id already in the URL), set for
 *    every event including gtag's own, so no event carries `document.title` (board titles name the stop).
 *
 * GA runs only where GA_MEASUREMENT_ID is set (production and staging in wrangler.jsonc). Dev, fixtures, e2e and unit
 * tests leave it unset: no tag, no Google origins in the CSP and no request to Google.
 */
export type SiteMode = 'ferry' | 'bus' | 'train' | 'transit'
export type SaveMode = 'bus' | 'train' | 'ferry'

/**
 * What the bootstrap sets up for the page (only when GA is on). The save handlers call
 * `window.__bftGa?.saveStop(mode, stopId)` once storage has kept a save (a refused write sends nothing): a global
 * rather than an import, so no handler's chunk grows by a shared module (a module several chunks import gets a chunk of
 * its own, ~250 B gz on the pages with a star). It sends the stop's id only, never its name or anything typed, and
 * never throws. Until /ga.js starts (after load and idle), the bootstrap also keeps the signals it needs: visible time,
 * whether the visitor has interacted, and the page it started on.
 */
export interface BftGa {
  siteMode: SiteMode
  /** Visible time before the current visible stretch, in performance.now() ms. */
  vis: number
  /** When the current visible stretch began (performance.now()), or null while hidden. */
  since: number | null
  /** The visitor has interacted (pointer down, key, input, a scroll past 50 px). */
  act: boolean
  /**
   * The pages (pathname + search) this visit has been on since the bootstrap ran, in order: /ga.js sends a page_view
   * for each, so a route change before it loaded still counts. It sets this to null when it takes over.
   */
  paths: string[] | null
  /** A URL as GA may see it: origin, path and only the GA_QUERY_KEEP parameters (never lat/lon or anything typed). */
  clean(url: string): string
  /** The page title GA may see for a path (gaPageTitle): never `document.title`, which names the stop. */
  title(path: string): string
  /** /ga.js has started (once per page load). */
  started?: boolean
  saveStop(mode: SaveMode, stopId: string): void
}

/**
 * The query parameters GA may see. The apps' own are ids, a time or a mode (to, from, route, at, mode, station,
 * terminal, trip); campaign and click ids are kept for Ads attribution. Everything else is dropped, notably
 * `?lat=&lon=` (Nearby and the maps) and the test switches.
 */
export const GA_QUERY_KEEP = [
  'to',
  'from',
  'route',
  'at',
  'mode',
  'station',
  'terminal',
  'trip',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'gbraid',
  'wbraid',
  'gad_source',
]

declare global {
  interface Window {
    __bftGa?: BftGa
  }
}

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/

export const GA_DOMAINS = ['brisbaneferry.com', 'brisbanebus.com', 'brisbanetrain.com', 'brisbanetransit.com']

/** The gtag.js library. A host source, so the bootstrap can insert its script tag without a nonce. */
export const GA_SCRIPT_ORIGIN = 'https://www.googletagmanager.com'

/** What each CSP directive adds when GA is on (Google's tag CSP guidance for GA4). */
export const GA_CSP = {
  script: [GA_SCRIPT_ORIGIN],
  // GA4 hits for this property go to the bare https://analytics.google.com/g/collect, which the wildcard doesn't
  // match. Google signals and Ads beacons (www.google.com, *.doubleclick.net) stay blocked: both are off here.
  connect: [
    'https://*.google-analytics.com',
    'https://analytics.google.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
  ],
  img: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
} as const

const TITLE_MODES = ['ferry', 'train', 'bus']

/**
 * The page title GA sees: the mode, the page type and, on a stop, station, terminal or route page, the id already in its
 * URL (e.g. "bus stop 10802", "train station central", "transit nearby", "ferry home"). Built from the path alone,
 * never from `document.title`, whose board titles carry the stop's name. A trip page is "trip" (no id); anything
 * unexpected is "page". The bootstrap carries the same function as JavaScript (TITLE_JS; analytics.test.ts checks
 * the two agree).
 */
export function gaPageTitle(path: string, siteMode: SiteMode): string {
  try {
    const s = String(path).split(/[?#]/)[0]?.split('/').filter(Boolean) ?? []
    const mode = TITLE_MODES.includes(s[0] as string) ? (s.shift() as string) : siteMode
    let type = s[0] ?? 'home'
    if (!/^[a-z][a-z-]{0,30}$/.test(type)) type = 'page'
    let id = ''
    if (/^(stop|station|terminal|route)$/.test(type) && s[1]) {
      id = decodeURIComponent(s[1])
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) id = ''
    }
    return [mode, type, id].filter(Boolean).join(' ')
  } catch {
    return siteMode
  }
}

/** gaPageTitle in the bootstrap (`g` is __bftGa, set by then). */
const TITLE_JS =
  'function title(p){try{var s=String(p).split(/[?#]/)[0].split("/").filter(Boolean),m=["ferry","train","bus"].indexOf(s[0])>=0?s.shift():g.siteMode,t=s[0]||"home",i="";if(!/^[a-z][a-z-]{0,30}$/.test(t))t="page";if(/^(stop|station|terminal|route)$/.test(t)&&s[1]){i=decodeURIComponent(s[1]);if(!/^[A-Za-z0-9._-]{1,40}$/.test(i))i=""}return [m,t,i].filter(Boolean).join(" ")}catch(e){return g.siteMode}}'

/** GA_MEASUREMENT_ID when it is a GA4 measurement id, else null (unset, or not one: GA stays off). */
export function gaId(value: string | undefined): string | null {
  return value && MEASUREMENT_ID.test(value) ? value : null
}

/** " origin origin" to append to a CSP directive's sources when GA is on, else "". */
export function gaSources(on: boolean, directive: keyof typeof GA_CSP): string {
  return on ? ` ${GA_CSP[directive].join(' ')}` : ''
}

/**
 * The root's inline bootstrap, nonce'd beside the theme script: the dataLayer and gtag stub, the config, then the
 * gtag.js tag (allowed by its host source in script-src) and, once the page has loaded and gone idle, this app's
 * /ga.js (page views and the engaged-visit timer, analytics-run.ts). `__bftGa` (BftGa) carries site_mode, saveStop, the URL
 * cleaner and the early signals /ga.js picks up (visible time, interaction, the first page). Null when GA is
 * off. `debug` (staging) sends debug_mode, so DebugView shows the visit; GA treats any debug_mode as on, so
 * production leaves the key out.
 */
export function gaBootstrap(
  measurementId: string | undefined,
  siteMode: SiteMode,
  debug = false,
): string | null {
  const id = gaId(measurementId)
  if (!id) return null
  const config = {
    send_page_view: false,
    site_mode: siteMode,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    linker: { domains: GA_DOMAINS },
    ...(debug ? { debug_mode: true } : {}),
  }
  // Every value is fixed or checked above, so the JSON can't close the script element. In a function, so its
  // variables don't become globals. page_location and page_referrer are set to cleaned URLs, so no event carries a
  // full query string (gtag would send document.location otherwise).
  return [
    '(function(){window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};',
    `var d=document,p=performance,K=${JSON.stringify(GA_QUERY_KEEP)};`,
    'function clean(u){try{var x=new URL(u,location.href),q=new URLSearchParams();x.searchParams.forEach(function(v,k){if(K.indexOf(k)>=0)q.append(k,v)});q=q.toString();return x.origin+x.pathname+(q?"?"+q:"")}catch(e){return location.origin+location.pathname}}',
    `var g=window.__bftGa={siteMode:${JSON.stringify(siteMode)},vis:0,since:d.visibilityState==="visible"?p.now():null,act:false,paths:[location.pathname+location.search],clean:clean,title:title,`,
    'saveStop:function(m,id){try{gtag("event","save_stop",{site_mode:g.siteMode,page_location:clean(location.href),page_title:title(location.pathname),mode:m,stop_id:String(id),value:3,currency:"AUD"})}catch(e){}}};',
    TITLE_JS,
    'd.addEventListener("visibilitychange",function(){var n=p.now();if(d.visibilityState==="visible"){if(g.since==null)g.since=n}else if(g.since!=null){g.vis+=n-g.since;g.since=null}});',
    'function a(){g.act=true}var o={capture:true,passive:true};["pointerdown","keydown","input"].forEach(function(t){d.addEventListener(t,a,o)});',
    // React Router navigates with history.pushState/replaceState (and popstate for Back): note each route until /ga.js.
    'function rec(){var k=location.pathname+location.search,l=g.paths;if(l&&l[l.length-1]!==k)l.push(k)}',
    'var H=history;["pushState","replaceState"].forEach(function(m){var f=H[m];H[m]=function(){var r=f.apply(this,arguments);rec();return r}});addEventListener("popstate",rec);',
    'd.addEventListener("scroll",function(e){var t=e.target;if((t===d||t===d.documentElement?scrollY:t.scrollTop)>50)a()},o);',
    // The page's cleaned URL, referrer and path title go in "set", not the config: a config value outranks "set", so
    // gtag's own events (scroll, user_engagement) would keep the first page's after a route change (/ga.js sets the
    // new page's on each change).
    `var c=${JSON.stringify(config)};var q={page_location:clean(location.href),page_title:title(location.pathname)};if(d.referrer)q.page_referrer=clean(d.referrer);`,
    `gtag("js",new Date());gtag("set",q);gtag("config",${JSON.stringify(id)},c);`,
    `var s=d.createElement("script");s.async=true;s.src=${JSON.stringify(`${GA_SCRIPT_ORIGIN}/gtag/js?id=${id}`)};d.head.appendChild(s);`,
    'addEventListener("load",function(){(window.requestIdleCallback||setTimeout)(function(){import("/ga.js").catch(function(){})})})})()',
  ].join('')
}

/**
 * The root loader's GA part: `{ ga }` (the bootstrap) when GA is on, else nothing at all, so a page without GA carries
 * no extra loader data (the first-load budgets are measured with GA off).
 */
export function gaRootData(
  measurementId: string | undefined,
  siteMode: SiteMode,
  debug = false,
): { ga?: string } {
  const ga = gaBootstrap(measurementId, siteMode, debug)
  return ga ? { ga } : {}
}
