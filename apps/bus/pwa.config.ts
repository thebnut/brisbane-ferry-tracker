/**
 * PWA (vite-plugin-pwa 2 / Workbox; the service worker is app/sw.ts): installable manifest, precached app shell,
 * and runtime caches:
 *  - pages and their `.data` loader requests: network first, fall back to the last copy (saved stops open offline)
 *  - /v1/bus departures and trips: network first (4 s timeout), keep for 24 h
 *  - /data/bus/stops.json and lines.json: stale-while-revalidate (the search index is fetched once, then instant)
 *  - /data/bus/geo/*: stale-while-revalidate (nearby tiles you have used)
 * Saved stops also keep a longer timetable copy in localStorage (app/lib/storage.ts) for "Offline · scheduled".
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
    // Our own service worker (app/sw.ts) with Workbox bundled in: generateSW loaded the Workbox runtime with
    // importScripts, which could fail and leave the page unstyled offline (R3-F1).
    strategies: 'injectManifest',
    srcDir: 'app',
    filename: 'sw.ts',
    injectManifest: {
      globDirectory: 'build/client',
      globPatterns: ['assets/*.{js,css,svg}', '*.{png,ico,svg}'],
      // MapLibre (lazy chunk) is large; leave it to the HTTP cache. Client data has its own runtime caches.
      globIgnores: ['assets/maplibre*', 'assets/MapView*', 'data/**'],
      maximumFileSizeToCacheInBytes: 600 * 1024,
      rollupFormat: 'iife',
    },
  })
}
