/** The service worker (vite-plugin-pwa injectManifest, see pwa.config.ts; shared logic in @bft/ui/sw). */
import { startServiceWorker } from '@bft/ui/sw'

declare const self: { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

startServiceWorker({
  manifest: self.__WB_MANIFEST,
  appName: 'BrisbaneBus',
  themeColor: '#FF6B35',
  // entry.client.tsx also writes the first page view into this cache.
  pages: { cacheName: 'bus-pages', maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
  // React Router client navigations fetch loader data from `<path>.data`; cached like the pages so a saved stop
  // opened from the offline home page still loads (its board then shows the offline timetable).
  routeData: { cacheName: 'bus-route-data', maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
  live: {
    match: /^\/(__fixtures\/)?v1\/bus\/(stops|trips)\//,
    cacheName: 'bus-data',
    maxEntries: 120,
    maxAgeSeconds: 24 * 3600,
  },
  staticData: [
    {
      match: /^\/(__fixtures\/)?data\/bus\/(stops|lines)\.json$/,
      cacheName: 'bus-index',
      maxEntries: 4,
      maxAgeSeconds: 7 * 24 * 3600,
    },
    {
      match: /^\/(__fixtures\/)?data\/bus\/geo\//,
      cacheName: 'bus-geo',
      maxEntries: 60,
      maxAgeSeconds: 7 * 24 * 3600,
    },
  ],
})
