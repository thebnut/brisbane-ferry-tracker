/**
 * PWA (vite-plugin-pwa 2 / Workbox): installable manifest, precached app shell (JS, CSS, icons, prerendered pages) and
 * runtime caches so a visitor who goes offline still sees their pair's timetable ("Offline · scheduled"):
 *  - pages: network first, fall back to the last server-rendered copy
 *  - /v1/ferry departures and trips: network first (4 s timeout), keep today's responses for 24 h
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
      name: 'Brisbane Ferry Tracker',
      short_name: 'BrisFerry',
      description: 'Live CityCat and ferry departures for every Brisbane ferry terminal.',
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
      globPatterns: ['assets/*.{js,css,png,webp,woff2}', '*.{png,ico}'],
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
            // entry.client.tsx also writes the first page view into this cache.
            cacheName: 'ferry-pages',
            // Pages served from this cache never claim LIVE before a live call confirms it (R2-T7).
            plugins: [markCachedPages],
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 3600 },
          },
        },
        {
          urlPattern: ({ url }) => /^\/(__fixtures\/)?v1\/ferry\/(stops|trips)\//.test(url.pathname),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'ferry-data',
            // Responses served from this cache are marked so the page shows them as offline, not live.
            plugins: [markCacheHits],
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 80, maxAgeSeconds: 24 * 3600 },
          },
        },
      ],
    },
  })
}
