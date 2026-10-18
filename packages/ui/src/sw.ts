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
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, getCacheKeyForURL, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { markCachedPages, markCacheHits } from './connectivity.ts'

interface CacheSpec {
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
interface SwScope {
  skipWaiting(): Promise<void>
  addEventListener(type: 'activate', fn: (e: ExtendableEventLike) => void): void
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
export function usablePageCopy(isPrecached: (url: string) => boolean) {
  return {
    cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) => {
      if (!cachedResponse) return null
      const html = await cachedResponse.clone().text()
      return referencedAssets(html).every(isPrecached) ? cachedResponse : null
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

  const isPrecached = (url: string) => getCacheKeyForURL(url) !== undefined
  const expire = (c: CacheSpec) =>
    new ExpirationPlugin({ maxEntries: c.maxEntries, maxAgeSeconds: c.maxAgeSeconds })

  const pages = new NetworkFirst({
    cacheName: config.pages.cacheName,
    networkTimeoutSeconds: 4,
    // Order matters: a copy from another build is dropped before it's marked as a cached page (R2-T7).
    plugins: [expire(config.pages), usablePageCopy(isPrecached), markCachedPages],
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
      new NetworkFirst({ cacheName: spec.cacheName, networkTimeoutSeconds: 4, plugins: [expire(spec)] }),
    )
  }
  registerRoute(
    ({ url }) => config.live.match.test(url.pathname),
    new NetworkFirst({
      cacheName: config.live.cacheName,
      networkTimeoutSeconds: 4,
      // Responses served from this cache are marked so the page shows them as offline, not live.
      plugins: [expire(config.live), markCacheHits],
    }),
  )
  for (const spec of config.staticData ?? []) {
    registerRoute(
      ({ url }) => spec.match.test(url.pathname),
      new StaleWhileRevalidate({ cacheName: spec.cacheName, plugins: [expire(spec)] }),
    )
  }

  // A new build: re-fetch the saved pages so their copies reference this build's assets (best effort, ≤ 10 s).
  sw.addEventListener('activate', (event) => {
    event.waitUntil(
      Promise.race([
        refreshPages(config.pages.cacheName),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]).catch(() => {}),
    )
  })
}

async function refreshPages(cacheName: string): Promise<void> {
  const cache = await caches.open(cacheName)
  const requests = await cache.keys()
  await Promise.allSettled(
    requests.map(async (req) => {
      const res = await fetch(req.url, { credentials: 'same-origin', cache: 'no-store' })
      if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html'))
        await cache.put(req.url, res)
    }),
  )
}
