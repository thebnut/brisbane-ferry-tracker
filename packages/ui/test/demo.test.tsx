// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

/** A Cache Storage stand-in that records deletions. */
function fakeCaches(names: string[]) {
  const deleted: string[] = []
  const storage = {
    keys: async () => [...names],
    delete: async (n: string) => {
      deleted.push(n)
      return true
    },
  } as unknown as CacheStorage
  return { storage, deleted }
}

describe('the one-off clean-up removes only what the device held when the page started (R9)', () => {
  it('a copy saved or rewritten since, and a cache created since, stay; the workers re-save their pages', async () => {
    const { clearDemoLeftovers } = await import('../src/demo-cleanup.ts')
    localStorage.setItem('bft-train-offline:central:', 'old day')
    localStorage.setItem('bft-bus-v1:1', 'rewritten since')
    localStorage.setItem('bft-ferry-v1:2', 'saved since')
    localStorage.setItem('bft-bus-saved', '[]')
    const start = {
      copies: new Map([
        ['bft-train-offline:central:', 'old day'],
        ['bft-bus-v1:1', 'old copy'],
      ]),
      caches: ['workbox-precache-v2-x', 'transit-pages', 'transit-old'],
    }
    const { storage, deleted } = fakeCaches([
      'workbox-precache-v2-x',
      'transit-pages',
      'transit-old',
      'transit-data',
    ])
    const resave = vi.fn(async () => {})
    expect(await clearDemoLeftovers({ all: true, start }, localStorage, storage, resave)).toBe(1)
    expect(localStorage.getItem('bft-train-offline:central:')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).toBe('rewritten since')
    expect(localStorage.getItem('bft-ferry-v1:2')).toBe('saved since')
    expect(localStorage.getItem('bft-bus-saved')).toBe('[]')
    expect(deleted).toEqual(['transit-pages', 'transit-old'])
    expect(resave).toHaveBeenCalledTimes(1)
    // Demo data is still removed wherever it is found.
    localStorage.setItem('bft-ferry-v1:3', JSON.stringify({ generation: 'fixture-20261020' }))
    deleted.length = 0
    expect(
      await clearDemoLeftovers(
        { all: true, start: { copies: new Map(), caches: [] } },
        localStorage,
        storage,
        resave,
      ),
    ).toBe(1)
    expect(localStorage.getItem('bft-ferry-v1:3')).toBeNull()
    expect(deleted).toEqual([])
    localStorage.clear()
  })

  it('nothing deleted: no re-save', async () => {
    const { clearDemoLeftovers } = await import('../src/demo-cleanup.ts')
    const { storage } = fakeCaches(['workbox-precache-v2-x'])
    const resave = vi.fn(async () => {})
    await clearDemoLeftovers({ all: true }, localStorage, storage, resave)
    expect(resave).not.toHaveBeenCalled()
  })

  it('a fresh device (nothing held at the start) only records that it is done; an older one is cleaned once', async () => {
    const { DEMO_MIGRATION_KEY, migrateOnce } = await import('../src/demo-cleanup.ts')
    const realCaches = (globalThis as { caches?: unknown }).caches
    const { storage, deleted } = fakeCaches(['transit-pages'])
    ;(globalThis as { caches?: unknown }).caches = storage
    try {
      // The service worker saved the home after the page started (the R9 race): the clean-up leaves it.
      localStorage.setItem('bft-transit-v1:1', 'saved since')
      await migrateOnce(Promise.resolve({ copies: new Map(), caches: [] }))
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBe('r7')
      expect(deleted).toEqual([])
      expect(localStorage.getItem('bft-transit-v1:1')).toBe('saved since')

      localStorage.clear()
      localStorage.setItem('bft-transit-v1:1', 'from before')
      await migrateOnce(
        Promise.resolve({
          copies: new Map([['bft-transit-v1:1', 'from before']]),
          caches: ['transit-pages'],
        }),
      )
      expect(localStorage.getItem('bft-transit-v1:1')).toBeNull()
      expect(deleted).toEqual(['transit-pages'])
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBe('r7')
      // Once only.
      localStorage.setItem('bft-transit-v1:1', 'from before')
      await migrateOnce(
        Promise.resolve({
          copies: new Map([['bft-transit-v1:1', 'from before']]),
          caches: ['transit-pages'],
        }),
      )
      expect(localStorage.getItem('bft-transit-v1:1')).toBe('from before')
    } finally {
      ;(globalThis as { caches?: unknown }).caches = realCaches
      localStorage.clear()
    }
  })

  it('the hook notes the device before anything on the page is saved', async () => {
    function Allowed() {
      useFixtureCookie('bft_fixtures', false, false, true)
      return null
    }
    localStorage.clear()
    render(<Allowed />)
    // A board writes its copy once the page has rendered.
    localStorage.setItem('bft-ferry-v1:1', 'first visit')
    await vi.waitFor(() => expect(localStorage.getItem('bft-demo-cleanup')).toBe('r7'))
    expect(localStorage.getItem('bft-ferry-v1:1')).toBe('first visit')
    localStorage.clear()
  })

  it('asks every worker of the registration once to re-save', async () => {
    const { askWorkersToResave } = await import('../src/demo-cleanup.ts')
    const active = { postMessage: vi.fn() }
    const installing = { postMessage: vi.fn() }
    const container = {
      getRegistration: async () => ({ installing, waiting: null, active }),
    } as unknown as ServiceWorkerContainer
    await askWorkersToResave(container)
    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'bft-resave-pages' })
    expect(active.postMessage).toHaveBeenCalledTimes(1)
    await askWorkersToResave(undefined)
  })
})
