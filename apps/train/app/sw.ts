/** The service worker (vite-plugin-pwa injectManifest, see pwa.config.ts; shared logic in @bft/ui/sw). */
import { startServiceWorker } from '@bft/ui/sw'

declare const self: { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

startServiceWorker({
  manifest: self.__WB_MANIFEST,
  appName: 'BrisbaneTrain',
  themeColor: '#FF6B35',
  // entry.client.tsx also writes the first page view into this cache.
  pages: { cacheName: 'train-pages', maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 },
  live: {
    match: /^\/(__fixtures\/)?v1\/train\/(stops|trips)\//,
    cacheName: 'train-data',
    maxEntries: 120,
    maxAgeSeconds: 24 * 3600,
  },
})
