/**
 * PWA (vite-plugin-pwa 2 / Workbox): installable manifest, precached app shell (JS, CSS, icons) and runtime caches
 * (app/sw.ts, @bft/ui/sw) so a visitor who goes offline still sees their pair's timetable ("Offline · scheduled"):
 *  - pages: network first, fall back to the last server-rendered copy (or a styled offline page)
 *  - /v1/ferry departures and trips: network first (4 s timeout), keep today's responses for 24 h
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
    // Our own service worker (app/sw.ts) with Workbox bundled in: generateSW loaded the Workbox runtime with
    // importScripts, which could fail and leave the page unstyled offline (R3-F1).
    strategies: 'injectManifest',
    srcDir: 'app',
    filename: 'sw.ts',
    injectManifest: {
      globDirectory: 'build/client',
      globPatterns: ['assets/*.{js,css,png,webp,woff2}', '*.{png,ico}'],
      // MapLibre (lazy chunk) is large; leave it to the HTTP cache.
      globIgnores: ['assets/maplibre*', 'assets/MapView*'],
      maximumFileSizeToCacheInBytes: 600 * 1024,
      rollupFormat: 'iife',
    },
  })
}
