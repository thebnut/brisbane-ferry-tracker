import { describe, expect, it } from 'vitest'
import {
  cleanUpCaches,
  offlinePage,
  pagesToResave,
  referencedAssets,
  savePages,
  usablePageCopy,
} from '../src/sw.ts'

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

describe('pages saved at install (R8-T1)', () => {
  it('keeps ordinary HTML pages only: not an error, not demo, not another type', async () => {
    const put: string[] = []
    const storage = {
      open: async () => ({ put: async (url: string) => void put.push(url) }),
    } as unknown as CacheStorage
    const answers: Record<string, Response> = {
      '/': new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      '/demo': new Response('<html></html>', { headers: { 'content-type': 'text/html', 'x-bft-demo': '1' } }),
      '/err': new Response('<html></html>', { status: 503, headers: { 'content-type': 'text/html' } }),
      '/json': Response.json({}),
    }
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      expect(init?.cache).toBe('no-store')
      if (url === '/down') throw new TypeError('Failed to fetch')
      return answers[url] as Response
    }) as typeof fetch
    try {
      const saved = await savePages('transit-pages', ['/', '/demo', '/err', '/json', '/down'], storage)
      expect(saved).toEqual([true, false, false, false, false])
      expect(put).toEqual(['/'])
    } finally {
      globalThis.fetch = real
    }
  })
})

describe('pages re-saved after the demo clean-up (R9)', () => {
  const origin = 'https://transit.example'
  it("the install-time pages and the sender's own ordinary page, never another origin's or a demo one", () => {
    expect(pagesToResave(['/'], `${origin}/ferry`, origin)).toEqual(['/', `${origin}/ferry`])
    expect(pagesToResave(['/'], `${origin}/`, origin)).toEqual(['/', `${origin}/`])
    expect(pagesToResave([], `${origin}/stop/1?x=1`, origin)).toEqual([`${origin}/stop/1?x=1`])
    for (const url of [
      'https://evil.example/',
      `${origin}/stop/1?fixtures=1`,
      `${origin}/stop/1?rt=off`,
      `${origin}/__fixtures/v1/x`,
      'not a url',
      undefined,
    ])
      expect(pagesToResave(['/'], url, origin)).toEqual(['/'])
  })
})
