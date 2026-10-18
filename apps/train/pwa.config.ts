/**
 * PWA (vite-plugin-pwa 2 / Workbox): installable manifest, precached app shell (JS, CSS, icons, the station and
 * line data) and runtime caches so a visitor who goes offline still sees their stations' timetables:
 *  - pages: network first, fall back to the last server-rendered copy
 *  - /v1/train departures and trips: network first (4 s timeout), keep today's responses for 24 h
 * The full-day timetable for favourites is kept separately in localStorage (app/lib/offline.ts).
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
      name: 'BrisbaneTrain Departure Boards',
      short_name: 'BrisTrain',
      description:
        'Live train departures, platforms and line status for every South East Queensland station.',
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
      globPatterns: ['assets/*.{js,css,svg}', '*.{png,ico,svg}', 'data/train/*.json'],
      // MapLibre (lazy chunk) is large; leave it to the HTTP cache.
      globIgnores: ['assets/maplibre*', 'assets/MapView*'],
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
            cacheName: 'train-pages',
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) => /^\/(__fixtures\/)?v1\/train\/(stops|trips)\//.test(url.pathname),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'train-data',
            // Responses served from this cache are marked so the page shows them as offline, not live.
            plugins: [markCacheHits],
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 120, maxAgeSeconds: 24 * 3600 },
          },
        },
      ],
    },
  })
}
