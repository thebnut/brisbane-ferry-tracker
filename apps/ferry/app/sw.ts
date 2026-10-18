/** The service worker (vite-plugin-pwa injectManifest, see pwa.config.ts; shared logic in @bft/ui/sw). */
import { startServiceWorker } from '@bft/ui/sw'

declare const self: { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

startServiceWorker({
  manifest: self.__WB_MANIFEST,
  appName: 'BrisbaneFerry',
  themeColor: '#FF6B35',
  // entry.client.tsx also writes the first page view into this cache.
  pages: { cacheName: 'ferry-pages', maxEntries: 30, maxAgeSeconds: 7 * 24 * 3600 },
  live: {
    match: /^\/(__fixtures\/)?v1\/ferry\/(stops|trips)\//,
    cacheName: 'ferry-data',
    maxEntries: 80,
    maxAgeSeconds: 24 * 3600,
  },
})
