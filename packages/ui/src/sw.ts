/**
 * The service worker every app runs (R3-F1), built by vite-plugin-pwa's `injectManifest` from each app's `app/sw.ts`.
 * Workbox is bundled into sw.js: no `importScripts` of a separate workbox runtime that can fail to load.
 *
 *  - The app shell (JS, CSS, icons) is precached; outdated precaches are cleaned up.
 *  - Pages are network first (4 s timeout), falling back to the last copy, which is marked so it never claims LIVE
 *    (markCachedPages, R2-T7). A copy is used only if every stylesheet and script it references is precached by this
 *    build: an older build's HTML would otherwise render unstyled, without its app. When a new build activates it
 *    refreshes the saved pages from the network.
 *  - A page with no usable copy gets a styled offline page (no script) instead of the browser's error.
 *  - Live API data is network first and marked when it comes from the cache (markCacheHits); static data indexes and
 *    tiles are stale-while-revalidate.
 */
import { clientsClaim } from 'workbox-core'
import { CacheExpiration, ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import {
  DEMO_HEADER,
  holdCacheLock,
  markCachedPages,
  markCacheHits,
  RESAVE_PAGES,
  whileNoCleanup,
} from './connectivity.ts'

/**
 * Workbox plugin for the page and loader-data caches: demo responses are never stored. A cacheWillUpdate plugin
 * replaces Workbox's own "only 200" filter, so it keeps that rule too: an error must never replace a good copy
 * (Codex review).
 */
export const skipDemoResponses = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.status === 200 && !response.headers.has(DEMO_HEADER) ? response : null,
}

/**
 * Workbox plugin for every runtime cache, last in its list: the put waits while the one-off demo clean-up runs and
 * holds CACHE_WRITE_LOCK (shared) until it lands (R9), so the clean-up never deletes a response stored meanwhile.
 * Released at cacheDidUpdate, or after 10 s if the put failed. As a cacheWillUpdate plugin it replaces Workbox's own
 * "only 200" filter (NetworkFirst's, and StaleWhileRevalidate's 200-or-opaque), so it keeps that rule: only a 200 is
 * stored, never an error over a good copy.
 */
export const waitForCleanup = {
  cacheWillUpdate: async ({ response, state }: { response: Response; state?: Record<string, unknown> }) => {
    if (response.status !== 200) return null
    const release = await holdCacheLock('shared', 10_000)
    if (state) state.release = release
    else release()
    return response
  },
  cacheDidUpdate: async ({ state }: { state?: Record<string, unknown> }) => {
    ;(state?.release as (() => void) | undefined)?.()
  },
}

export interface CacheSpec {
  cacheName: string
  maxEntries: number
  maxAgeSeconds: number
}

export interface ServiceWorkerConfig {
  /** `self.__WB_MANIFEST`, injected at build time. */
  manifest: Array<string | { url: string; revision: string | null }>
  /** Shown on the offline page, e.g. "BrisbaneFerry". */
  appName: string
  /** Brand colour for the offline page's heading rule. */
  themeColor: string
  pages: CacheSpec
  /**
   * Pages saved into the page cache when this worker installs (R8-T1: the transit home), so they open offline even
   * if the visitor went offline before the first page view was saved, or only ever opened another page.
   */
  installPages?: string[]
  /** React Router client-navigation loader data (`<path>.data`), cached like the pages. */
  routeData?: CacheSpec
  /** Live /v1 departures and trips. */
  live: CacheSpec & { match: RegExp }
  /** Static data files (stop indexes, lines, geo tiles). */
  staticData?: Array<CacheSpec & { match: RegExp }>
}

/** The few service-worker globals used here (the app tsconfigs use the DOM lib, not WebWorker). */
interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void
}
interface ExtendableMessageEventLike extends ExtendableEventLike {
  data: unknown
  source: { url?: string } | null
}
interface SwScope {
  skipWaiting(): Promise<void>
  location: { origin: string }
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEventLike) => void): void
  addEventListener(type: 'message', fn: (e: ExtendableMessageEventLike) => void): void
}

/** Demo and test switches: a page with one is never re-saved (the apps' copy writers skip them too). */
const NO_RESAVE_PARAMS = ['fixtures', 'rt']

/**
 * The pages a RESAVE_PAGES message asks for: the install-time pages and the sending page, if it is an ordinary page
 * of this origin. Only the sender's own URL is used, never one carried in the message.
 */
export function pagesToResave(
  installPages: string[],
  senderUrl: string | undefined,
  origin: string,
): string[] {
  const pages = new Set(installPages)
  try {
    const url = senderUrl ? new URL(senderUrl) : undefined
    if (
      url &&
      url.origin === origin &&
      !url.pathname.startsWith('/__') &&
      !NO_RESAVE_PARAMS.some((k) => url.searchParams.has(k))
    )
      pages.add(url.href)
  } catch {
    // Not a URL: only the install-time pages.
  }
  return [...pages]
}

/** Same-origin stylesheet and script URLs a page's HTML references (links, modulepreloads, the entry import). */
export function referencedAssets(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/["'](\/assets\/[^"'?#\s]+\.(?:css|js))["']/g)) if (m[1]) found.add(m[1])
  return [...found]
}

/**
 * Plugin for the page cache: a cached copy whose stylesheets or scripts this build doesn't precache is unusable (it
 * would render unstyled and without its app), so it counts as a miss and the offline page is shown instead.
 * `isPrecached` is injectable for tests.
 */
export function usablePageCopy(isPrecached: (url: string) => boolean | Promise<boolean>) {
  return {
    cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) => {
      if (!cachedResponse) return null
      const html = await cachedResponse.clone().text()
      const present = await Promise.all(referencedAssets(html).map(async (u) => isPrecached(u)))
      return present.every(Boolean) ? cachedResponse : null
    },
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Policy for the offline page: no script at all, styles from this origin and its own <style>. */
export const OFFLINE_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

/**
 * A styled offline page for a page this device has no usable copy of. It uses the app's precached stylesheet (fonts,
 * colours) plus a small inline style, has no script, and never claims LIVE. A meta refresh retries every 30 s, so it
 * turns into the real page once the network is back.
 */
export function offlinePage({
  appName,
  themeColor,
  stylesheets,
  path,
}: {
  appName: string
  themeColor: string
  stylesheets: string[]
  path: string
}): string {
  const links = stylesheets.map((h) => `<link rel="stylesheet" href="${escapeHtml(h)}">`).join('')
  const name = escapeHtml(appName)
  const style = [
    'body{margin:0;font-family:"Inter Variable",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2937;background:#fff}',
    'main{max-width:32rem;margin:0 auto;padding:2.5rem 1rem}',
    `h1{font-size:1.25rem;margin:0 0 .75rem;padding-bottom:.5rem;border-bottom:3px solid ${escapeHtml(themeColor)}}`,
    'p{line-height:1.5;margin:.5rem 0}',
    '[data-banner]{display:inline-block;font-weight:600;font-size:.875rem;padding:.25rem .625rem;border-radius:999px;background:#f3f4f6;color:#374151}',
    'a{color:inherit;font-weight:600}',
  ].join('')
  return [
    '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<meta http-equiv="refresh" content="30"><title>Offline | ${name}</title>${links}<style>${style}</style></head>`,
    `<body><main data-offline-page=""><p data-banner="offline">Offline</p><h1>${name}</h1>`,
    "<p>You are offline, and this page isn't saved on this device yet.</p>",
    '<p>Pages you have opened before still open offline, with their timetable times.</p>',
    `<p><a href="${escapeHtml(path)}">Try again</a> · <a href="/">Home</a></p></main></body></html>`,
  ].join('')
}

export function startServiceWorker(config: ServiceWorkerConfig): void {
  const sw = self as unknown as SwScope
  void sw.skipWaiting()
  clientsClaim()
  precacheAndRoute(config.manifest)
  cleanupOutdatedCaches()

  // In Cache Storage, not just in the manifest: an evicted or half-written precache must not pass (Codex review).
  const isPrecached = async (url: string) => (await matchPrecache(url).catch(() => undefined)) != null
  const expire = (c: CacheSpec) =>
    new ExpirationPlugin({ maxEntries: c.maxEntries, maxAgeSeconds: c.maxAgeSeconds })

  const pages = new NetworkFirst({
    cacheName: config.pages.cacheName,
    networkTimeoutSeconds: 4,
    // Order matters: a copy from another build is dropped before it's marked as a cached page (R2-T7).
    plugins: [
      expire(config.pages),
      skipDemoResponses,
      usablePageCopy(isPrecached),
      markCachedPages,
      waitForCleanup,
    ],
  })
  const stylesheets = config.manifest
    .map((e) => (typeof e === 'string' ? e : e.url))
    .filter((u) => /^\/?assets\/root-[^/]*\.css$/.test(u))
    .map((u) => (u.startsWith('/') ? u : `/${u}`))
  registerRoute(
    ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/__'),
    async (options) => {
      try {
        return await pages.handle(options)
      } catch {
        const url = new URL(options.request.url)
        return new Response(
          offlinePage({
            appName: config.appName,
            themeColor: config.themeColor,
            stylesheets,
            path: url.pathname + url.search,
          }),
          {
            status: 503,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
              'content-security-policy': OFFLINE_PAGE_CSP,
            },
          },
        )
      }
    },
  )

  if (config.routeData) {
    const spec = config.routeData
    registerRoute(
      ({ url }) => url.pathname.endsWith('.data') && !url.pathname.startsWith('/__'),
      new NetworkFirst({
        cacheName: spec.cacheName,
        networkTimeoutSeconds: 4,
        plugins: [expire(spec), skipDemoResponses, waitForCleanup],
      }),
    )
  }
  registerRoute(
    ({ url }) => config.live.match.test(url.pathname),
    new NetworkFirst({
      cacheName: config.live.cacheName,
      networkTimeoutSeconds: 4,
      // Responses served from this cache are marked so the page shows them as offline, not live.
      plugins: [expire(config.live), markCacheHits, waitForCleanup],
    }),
  )
  for (const spec of config.staticData ?? []) {
    registerRoute(
      ({ url }) => spec.match.test(url.pathname),
      new StaleWhileRevalidate({ cacheName: spec.cacheName, plugins: [expire(spec), waitForCleanup] }),
    )
  }

  // Best effort and bounded: a page that can't be fetched never fails the install.
  const installPages = config.installPages ?? []
  if (installPages.length)
    sw.addEventListener('install', (event) => {
      event.waitUntil(
        Promise.race([
          savePages(config.pages.cacheName, installPages),
          new Promise((resolve) => setTimeout(resolve, 10_000)),
        ]).catch(() => {}),
      )
    })

  // The one-off demo clean-up dropped the page cache, maybe just after this worker saved its pages at install or the
  // page saved its own copy: save them again (R9). Best effort and bounded, like the install.
  sw.addEventListener('message', (event) => {
    if ((event.data as { type?: unknown } | null)?.type !== RESAVE_PAGES) return
    const urls = pagesToResave(installPages, event.source?.url, sw.location.origin)
    event.waitUntil(
      Promise.race([
        savePages(config.pages.cacheName, urls),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]).catch(() => {}),
    )
  })

  // A new build: drop caches it doesn't own and expired entries (R6-B1), then re-fetch the saved pages so their
  // copies reference this build's assets (best effort, ≤ 10 s).
  sw.addEventListener('activate', (event) => {
    event.waitUntil(
      Promise.race([
        cleanUpCaches(runtimeCaches(config)).then(() => refreshPages(config.pages.cacheName)),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]).catch(() => {}),
    )
  })
}

/** The runtime caches this build uses. */
export function runtimeCaches(config: ServiceWorkerConfig): CacheSpec[] {
  return [config.pages, config.routeData, config.live, ...(config.staticData ?? [])].filter(
    (c): c is CacheSpec => c != null,
  )
}

/**
 * Caches an older build left behind (another name, a runtime it no longer has) still hold old bodies that nothing
 * expires: delete every cache that isn't one of this build's runtime caches or a workbox precache (whose old versions
 * cleanupOutdatedCaches handles), and expire this build's own entries past their age now rather than on next use.
 */
export async function cleanUpCaches(specs: CacheSpec[], storage: CacheStorage = caches): Promise<string[]> {
  const own = new Set(specs.map((c) => c.cacheName))
  const removed: string[] = []
  for (const name of await storage.keys()) {
    if (own.has(name) || name.startsWith('workbox-precache')) continue
    if (await storage.delete(name)) removed.push(name)
  }
  await Promise.allSettled(
    specs.map((c) =>
      new CacheExpiration(c.cacheName, {
        maxEntries: c.maxEntries,
        maxAgeSeconds: c.maxAgeSeconds,
      }).expireEntries(),
    ),
  )
  return removed
}

async function refreshPages(cacheName: string): Promise<void> {
  const cache = await caches.open(cacheName)
  await savePages(
    cacheName,
    (await cache.keys()).map((req) => req.url),
  )
}

/**
 * Fetches each page from the network and keeps it in the page cache if it is an ordinary HTML page (not an error, not
 * demo). Whether a kept copy is used is still up to usablePageCopy (its assets must be precached, #61).
 */
export async function savePages(cacheName: string, urls: string[], storage: CacheStorage = caches) {
  const cache = await storage.open(cacheName)
  const saved = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      if (
        !res.ok ||
        res.headers.has(DEMO_HEADER) ||
        !(res.headers.get('content-type') ?? '').includes('text/html')
      )
        return false
      await whileNoCleanup(() => cache.put(url, res))
      return true
    }),
  )
  return saved.map((r) => r.status === 'fulfilled' && r.value)
}
