/**
 * PWA (vite-plugin-pwa 2 / Workbox): installable manifest, precached app shell, and runtime caches:
 *  - pages and their `.data` loader requests: network first, fall back to the last copy (Saved opens offline)
 *  - /v1/{ferry,train,bus} departures and trips: network first (4 s timeout), keep for 24 h
 *  - /data/{mode}/stops.json and lines.json: stale-while-revalidate (search indexes are fetched once, then instant)
 *  - /data/{mode}/geo/*: stale-while-revalidate (nearby tiles you have used)
 * Saved cards also keep a 20-row copy in localStorage (app/lib/saved.ts) for "Offline · scheduled". /v1/ask is
 * never cached (POST).
 * Map tiles are not cached (OpenFreeMap's terms and size).
 */
import { markCacheHits } from '@bft/ui/connectivity'
import { VitePWA } from 'vite-plugin-pwa'

export function pwa() {
  return VitePWA({
    registerType: 'autoUpdate',
    injectRegister: false,
    outDir: 'build/client',
    manifestFilename: 'manifest.webmanifest',
    manifest: {
      name: 'BrisbaneTransit Departure Boards',
      short_name: 'BrisbaneTransit',
      description:
        'Live Brisbane ferry, train and bus departures in one app, with what is leaving around you.',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#FFFFFF',
      theme_color: '#FF6B35',
      lang: 'en-AU',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    workbox: {
      globDirectory: 'build/client',
      globPatterns: ['assets/*.{js,css,svg}', '*.{png,ico,svg}'],
      // MapLibre (lazy chunk) is large; leave it to the HTTP cache. Client data has its own runtime caches.
      globIgnores: ['assets/maplibre*', 'assets/MapView*', 'data/**'],
      maximumFileSizeToCacheInBytes: 600 * 1024,
      navigateFallback: null,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/__'),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'transit-pages',
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
        {
          // React Router client navigations fetch loader data from `<path>.data`; cache it like the pages so a
          // saved stop opened from the offline home page still loads (its board then shows the offline timetable).
          urlPattern: ({ url }) => url.pathname.endsWith('.data') && !url.pathname.startsWith('/__'),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'transit-route-data',
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) =>
            /^\/(__fixtures\/)?v1\/(ferry|train|bus)\/(stops|trips)\//.test(url.pathname),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'transit-data',
            // Responses served from this cache are marked so the page shows them as offline, not live.
            plugins: [markCacheHits],
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 120, maxAgeSeconds: 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) =>
            /^\/(__fixtures\/)?data\/(ferry|train|bus)\/(stops|lines)\.json$/.test(url.pathname),
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'transit-index',
            expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) => /^\/(__fixtures\/)?data\/(ferry|train|bus)\/geo\//.test(url.pathname),
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'transit-geo',
            expiration: { maxEntries: 120, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
      ],
    },
  })
}
