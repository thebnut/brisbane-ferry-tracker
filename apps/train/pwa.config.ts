/**
 * PWA (vite-plugin-pwa 2 / Workbox; the service worker is app/sw.ts): installable manifest, precached app shell
 * (JS, CSS, icons, the station and line data) and runtime caches so a visitor who goes offline still sees their
 * stations' timetables:
 *  - pages: network first, fall back to the last server-rendered copy
 *  - /v1/train departures and trips: network first (4 s timeout), keep today's responses for 24 h
 * The full-day timetable for favourites is kept separately in localStorage (app/lib/offline.ts).
 * Map tiles are not cached (OpenFreeMap's terms and size).
 */
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
    // Our own service worker (app/sw.ts) with Workbox bundled in: generateSW loaded the Workbox runtime with
    // importScripts, which could fail and leave the page unstyled offline (R3-F1).
    strategies: 'injectManifest',
    srcDir: 'app',
    filename: 'sw.ts',
    injectManifest: {
      globDirectory: 'build/client',
      globPatterns: ['assets/*.{js,css,svg}', '*.{png,ico,svg}', 'data/train/*.json'],
      // MapLibre (lazy chunk) is large; leave it to the HTTP cache.
      globIgnores: ['assets/maplibre*', 'assets/MapView*'],
      maximumFileSizeToCacheInBytes: 600 * 1024,
      rollupFormat: 'iife',
    },
  })
}
