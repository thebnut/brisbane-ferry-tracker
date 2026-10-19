/** The service worker (vite-plugin-pwa injectManifest, see pwa.config.ts; shared logic in @bft/ui/sw). */
import { startServiceWorker } from '@bft/ui/sw'

declare const self: { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

startServiceWorker({
  manifest: self.__WB_MANIFEST,
  appName: 'BrisbaneTransit',
  themeColor: '#FF6B35',
  // entry.client.tsx also writes the first page view into this cache.
  pages: { cacheName: 'transit-pages', maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
  // The home opens offline even before the first page view is saved, or when only a mode page was ever opened (R8-T1).
  installPages: ['/'],
  // React Router client navigations fetch loader data from `<path>.data`; cached like the pages so a saved stop
  // opened from the offline home page still loads (its board then shows the offline timetable).
  routeData: { cacheName: 'transit-route-data', maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
  live: {
    match: /^\/(__fixtures\/)?v1\/(ferry|train|bus)\/(stops|trips)\//,
    cacheName: 'transit-data',
    maxEntries: 120,
    maxAgeSeconds: 24 * 3600,
  },
  staticData: [
    {
      match: /^\/(__fixtures\/)?data\/(ferry|train|bus)\/(stops|lines)\.json$/,
      cacheName: 'transit-index',
      maxEntries: 8,
      maxAgeSeconds: 7 * 24 * 3600,
    },
    {
      match: /^\/(__fixtures\/)?data\/(ferry|train|bus)\/geo\//,
      cacheName: 'transit-geo',
      maxEntries: 120,
      maxAgeSeconds: 7 * 24 * 3600,
    },
  ],
})
