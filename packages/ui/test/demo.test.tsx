// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DemoExitLink,
  FIXTURE_COOKIE_MAX_AGE_S,
  fixtureCookie,
  isDemoSession,
  useFixtureCookie,
} from '../src/demo.tsx'

function Probe({ active, forced = false }: { active: boolean; forced?: boolean }) {
  useFixtureCookie('bft_fixtures', active, forced, false)
  return null
}
const at = (search: string) => window.history.replaceState(null, '', `/stop/10802${search}`)

describe('demo mode is easy to leave (R7-B1)', () => {
  it('the cookie lasts an hour, and clearing it expires it at once', () => {
    expect(FIXTURE_COOKIE_MAX_AGE_S).toBe(3600)
    expect(fixtureCookie('bft_fixtures', true)).toContain('max-age=3600')
    expect(fixtureCookie('bft_fixtures', false)).toContain('max-age=0')
  })

  it('?fixtures=1 starts it only when the server put the page in demo mode; ?fixtures=0 ends it and leaves the URL', () => {
    at('?fixtures=1')
    render(<Probe active={false} />)
    expect(document.cookie).not.toContain('bft_fixtures=1')
    render(<Probe active />)
    expect(document.cookie).toContain('bft_fixtures=1')
    expect(isDemoSession()).toBe(true)
    at('?fixtures=0&x=1')
    render(<Probe active={false} />)
    expect(document.cookie).not.toContain('bft_fixtures=1')
    expect(isDemoSession()).toBe(false)
    expect(location.search).toBe('?x=1')
    at('')
  })

  it('forced demo mode (FIXTURES=1) is no session: copies are kept as usual', () => {
    at('?fixtures=1')
    render(<Probe active forced />)
    expect(document.cookie).not.toContain('bft_fixtures=1')
    expect(isDemoSession()).toBe(false)
    at('')
  })

  it('the notices link out of it with ?fixtures=0', () => {
    render(<DemoExitLink />)
    expect(screen.getByRole('link', { name: 'Exit demo' }).getAttribute('href')).toBe('?fixtures=0')
  })
})

describe('demo data left on the device (Codex review of R7-B1)', () => {
  it('drops copies made from demo data, and the runtime caches when it found any', async () => {
    const { clearDemoLeftovers } = await import('../src/demo-cleanup.ts')
    localStorage.setItem(
      'bft-bus-offline:10802',
      JSON.stringify({ body: { staticGeneration: 'fixture-20261020' } }),
    )
    localStorage.setItem(
      'bft-bus-v1:1',
      JSON.stringify({ body: { staticGeneration: '20261017-20261216-x' } }),
    )
    localStorage.setItem('bft-bus-saved', '[]')
    const deleted: string[] = []
    const cacheStorage = {
      keys: async () => ['workbox-precache-v2-x', 'bus-pages', 'bus-data'],
      delete: async (n: string) => {
        deleted.push(n)
        return true
      },
    } as unknown as CacheStorage
    expect(await clearDemoLeftovers({}, localStorage, cacheStorage)).toBe(1)
    expect(localStorage.getItem('bft-bus-v1:10802')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).not.toBeNull()
    expect(deleted).toEqual(['bus-pages', 'bus-data'])
    deleted.length = 0
    expect(await clearDemoLeftovers({}, localStorage, cacheStorage)).toBe(0)
    expect(deleted).toEqual([])
    // The one-off clean-up where demo mode is allowed: every offline copy (train's carry no generation) and cache.
    localStorage.setItem('bft-train-offline:central:', JSON.stringify({ day: '20261020', rows: [] }))
    await clearDemoLeftovers({ all: true }, localStorage, cacheStorage)
    expect(deleted).toEqual(['bus-pages', 'bus-data'])
    expect(localStorage.getItem('bft-train-offline:central:')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).toBeNull()
    expect(localStorage.getItem('bft-bus-saved')).toBe('[]')
    localStorage.clear()
  })
})

describe('demo pages are never kept (Codex review of R7-B1)', () => {
  it('the service worker plugin and savePageCopy skip responses marked as demo', async () => {
    const { DEMO_HEADER, savePageCopy } = await import('../src/connectivity.ts')
    const { skipDemoResponses } = await import('../src/sw.ts')
    const page = (demo: boolean) =>
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html', ...(demo ? { [DEMO_HEADER]: '1' } : {}) },
      })
    expect(await skipDemoResponses.cacheWillUpdate({ response: page(true) })).toBeNull()
    expect(await skipDemoResponses.cacheWillUpdate({ response: page(false) })).not.toBeNull()
    // Workbox's own rule, which a cacheWillUpdate plugin replaces: an error never replaces a good copy.
    for (const status of [404, 500, 503])
      expect(await skipDemoResponses.cacheWillUpdate({ response: new Response('x', { status }) })).toBeNull()

    const put: string[] = []
    const cache = { put: async (url: string) => void put.push(url) }
    const g = globalThis as unknown as { caches?: unknown; fetch: typeof fetch }
    const realFetch = g.fetch
    g.caches = { open: async () => cache }
    let demo = true
    g.fetch = (async () => page(demo)) as typeof fetch
    expect(await savePageCopy('pages', '/stop/10802')).toBe(false)
    demo = false
    expect(await savePageCopy('pages', '/stop/10802')).toBe(true)
    expect(put).toEqual(['/stop/10802'])
    g.fetch = realFetch
    delete g.caches
  })
})
