/**
 * PWA (vite-plugin-pwa 2 / Workbox): installable manifest, precached app shell, and runtime caches:
 *  - pages and their `.data` loader requests: network first, fall back to the last copy (saved stops open offline)
 *  - /v1/bus departures and trips: network first (4 s timeout), keep for 24 h
 *  - /data/bus/stops.json and lines.json: stale-while-revalidate (the search index is fetched once, then instant)
 *  - /data/bus/geo/*: stale-while-revalidate (nearby tiles you have used)
 * Saved stops also keep a longer timetable copy in localStorage (app/lib/storage.ts) for "Offline · scheduled".
 * Map tiles are not cached (OpenFreeMap's terms and size).
 */
import { markCachedPages, markCacheHits } from '@bft/ui/connectivity'
import { VitePWA } from 'vite-plugin-pwa'

export function pwa() {
  return VitePWA({
    registerType: 'autoUpdate',
    injectRegister: false,
    outDir: 'build/client',
    manifestFilename: 'manifest.webmanifest',
    manifest: {
      name: 'BrisbaneBus Departure Boards',
      short_name: 'BrisbaneBus',
      description: 'Live bus departures for every Brisbane bus stop, busway platform and route.',
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
            cacheName: 'bus-pages',
            // Pages served from this cache never claim LIVE before a live call confirms it (R2-T7).
            plugins: [markCachedPages],
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
            cacheName: 'bus-route-data',
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) => /^\/(__fixtures\/)?v1\/bus\/(stops|trips)\//.test(url.pathname),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'bus-data',
            // Responses served from this cache are marked so the page shows them as offline, not live.
            plugins: [markCacheHits],
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 120, maxAgeSeconds: 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) => /^\/(__fixtures\/)?data\/bus\/(stops|lines)\.json$/.test(url.pathname),
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'bus-index', expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 3600 } },
        },
        {
          urlPattern: ({ url }) => /^\/(__fixtures\/)?data\/bus\/geo\//.test(url.pathname),
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'bus-geo', expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 } },
        },
      ],
    },
  })
}
