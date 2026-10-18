import { describe, expect, it } from 'vitest'
import { cleanUpCaches, offlinePage, referencedAssets, usablePageCopy } from '../src/sw.ts'

const html = `<html><head><link rel="stylesheet" href="/assets/root-abc.css"><link rel="modulepreload" href="/assets/entry.client-x1.js"></head>
<body><script type="module">import "/assets/manifest-1.js";import * as route0 from "/assets/root-y.js";</script>
<img src="/assets/logo.webp"><a href="/terminal/riverside">x</a></body></html>`

describe('service worker page copies (R3-F1)', () => {
  it('finds the stylesheets and scripts a page needs', () => {
    expect(referencedAssets(html).sort()).toEqual([
      '/assets/entry.client-x1.js',
      '/assets/manifest-1.js',
      '/assets/root-abc.css',
      '/assets/root-y.js',
    ])
  })

  it('uses a copy only when this build precaches all of them', async () => {
    const cachedResponse = new Response(html)
    const all = usablePageCopy(() => true)
    expect(await all.cachedResponseWillBeUsed({ cachedResponse })).toBe(cachedResponse)
    const old = usablePageCopy((u) => u !== '/assets/root-abc.css')
    expect(await old.cachedResponseWillBeUsed({ cachedResponse: new Response(html) })).toBeNull()
    expect(await all.cachedResponseWillBeUsed({})).toBeNull()
    // The check may be asynchronous (Cache Storage lookups).
    const evicted = usablePageCopy(async (u) => u !== '/assets/root-y.js')
    expect(await evicted.cachedResponseWillBeUsed({ cachedResponse: new Response(html) })).toBeNull()
  })

  it('the offline page is styled, script-free, escapes the path and claims nothing live', () => {
    const page = offlinePage({
      appName: 'BrisbaneFerry',
      themeColor: '#FF6B35',
      stylesheets: ['/assets/root-abc.css'],
      path: '/x?"><script>alert(1)</script>',
    })
    expect(page).toContain('<link rel="stylesheet" href="/assets/root-abc.css">')
    expect(page).not.toContain('<script')
    expect(page).not.toMatch(/LIVE|data-live-claim/)
    expect(page).toContain('data-banner="offline"')
  })
})

describe('stale caches on activate (R6-B1)', () => {
  it('deletes caches this build does not own, keeps its own and the precache', async () => {
    const names = [
      'bus-pages',
      'bus-data',
      'workbox-precache-v2-http://x/',
      'bus-api-old',
      'workbox-runtime-http://x/',
    ]
    const deleted: string[] = []
    const storage = {
      keys: async () => names,
      delete: async (n: string) => {
        deleted.push(n)
        return true
      },
    } as unknown as CacheStorage
    const spec = (cacheName: string) => ({ cacheName, maxEntries: 1, maxAgeSeconds: 1 })
    // CacheExpiration needs IndexedDB: its failure is settled, the deletes are what matter here.
    const removed = await cleanUpCaches([spec('bus-pages'), spec('bus-data')], storage)
    expect(removed).toEqual(['bus-api-old', 'workbox-runtime-http://x/'])
    expect(deleted).toEqual(removed)
  })
})
