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

/** An in-memory Cache Storage that records deletions ("name" for a cache, "name url" for an entry). */
function fakeCaches(init: Record<string, Record<string, Response>>) {
  const store = new Map(Object.entries(init).map(([n, e]) => [n, new Map(Object.entries(e))]))
  const deleted: string[] = []
  const cache = (name: string) => {
    const entries = store.get(name) ?? new Map<string, Response>()
    store.set(name, entries)
    return {
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      match: async (req: RequestInfo) => entries.get(typeof req === 'string' ? req : req.url)?.clone(),
      put: async (url: string, res: Response) => void entries.set(url, res),
      delete: async (req: RequestInfo) => {
        const url = typeof req === 'string' ? req : req.url
        deleted.push(`${name} ${url}`)
        return entries.delete(url)
      },
    }
  }
  const storage = {
    keys: async () => [...store.keys()],
    has: async (n: string) => store.has(n),
    open: async (n: string) => cache(n),
    delete: async (n: string) => {
      deleted.push(n)
      return store.delete(n)
    },
  } as unknown as CacheStorage
  return { storage, deleted, store }
}
const saved = (date: string) => new Response('<html></html>', { headers: { date } })
const OLD = 'Wed, 01 Oct 2026 00:00:00 GMT'
const NEW = 'Sun, 19 Oct 2026 02:30:00 GMT'
const u = (path: string) => `https://transit.example${path}`

describe('the one-off clean-up removes only what the device held when the page started (R9)', () => {
  it('copies and cached responses saved or rewritten since stay; the workers re-save their pages', async () => {
    const { clearDemoLeftovers } = await import('../src/demo-cleanup.ts')
    localStorage.setItem('bft-train-offline:central:', 'old day')
    localStorage.setItem('bft-bus-v1:1', 'rewritten since')
    localStorage.setItem('bft-ferry-v1:2', 'saved since')
    localStorage.setItem('bft-bus-saved', '[]')
    const { storage, deleted, store } = fakeCaches({
      'workbox-precache-v2-x': { [u('/assets/a.js')]: saved(OLD) },
      // The home was saved again after the page started (a new worker's install); /stop/1 is from before.
      'transit-pages': { [u('/')]: saved(NEW), [u('/stop/1')]: saved(OLD), [u('/ferry')]: saved(NEW) },
      'transit-data': { [u('/v1/x')]: saved(NEW) },
    })
    const stamp = `${OLD}||`
    const start = {
      copies: new Map([
        ['bft-train-offline:central:', 'old day'],
        ['bft-bus-v1:1', 'old copy'],
      ]),
      caches: new Map([
        ['workbox-precache-v2-x', new Map([[u('/assets/a.js'), stamp]])],
        [
          'transit-pages',
          new Map([
            [u('/'), stamp],
            [u('/stop/1'), stamp],
          ]),
        ],
        ['transit-old', new Map([[u('/gone'), stamp]])],
      ]),
    }
    const resave = vi.fn(async () => {})
    expect(await clearDemoLeftovers({ all: true, start }, localStorage, storage, resave)).toBe(1)
    expect(localStorage.getItem('bft-train-offline:central:')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).toBe('rewritten since')
    expect(localStorage.getItem('bft-ferry-v1:2')).toBe('saved since')
    expect(localStorage.getItem('bft-bus-saved')).toBe('[]')
    // Only the entry still holding its response from the start goes; no cache is dropped whole.
    expect(deleted).toEqual([`transit-pages ${u('/stop/1')}`])
    expect([...(store.get('transit-pages')?.keys() ?? [])]).toEqual([u('/'), u('/ferry')])
    expect(store.get('transit-data')?.size).toBe(1)
    expect(store.get('workbox-precache-v2-x')?.size).toBe(1)
    expect(resave).toHaveBeenCalledTimes(1)
    // Demo data is still removed wherever it is found.
    localStorage.setItem('bft-ferry-v1:3', JSON.stringify({ generation: 'fixture-20261020' }))
    deleted.length = 0
    resave.mockClear()
    expect(
      await clearDemoLeftovers(
        { all: true, start: { copies: new Map(), caches: new Map() } },
        localStorage,
        storage,
        resave,
      ),
    ).toBe(1)
    expect(localStorage.getItem('bft-ferry-v1:3')).toBeNull()
    expect(deleted).toEqual([])
    expect(resave).not.toHaveBeenCalled()
    localStorage.clear()
  })

  it('nothing deleted: no re-save', async () => {
    const { clearDemoLeftovers } = await import('../src/demo-cleanup.ts')
    const { storage } = fakeCaches({ 'workbox-precache-v2-x': {} })
    const resave = vi.fn(async () => {})
    await clearDemoLeftovers({ all: true }, localStorage, storage, resave)
    expect(resave).not.toHaveBeenCalled()
  })

  it('a fresh device (nothing held at the start) only records that it is done; an older one is cleaned once', async () => {
    const { DEMO_MIGRATION_KEY, migrateOnce } = await import('../src/demo-cleanup.ts')
    const realCaches = (globalThis as { caches?: unknown }).caches
    const { storage, deleted } = fakeCaches({ 'transit-pages': { [u('/')]: saved(OLD) } })
    ;(globalThis as { caches?: unknown }).caches = storage
    const fromBefore = () =>
      Promise.resolve({
        copies: new Map([['bft-transit-v1:1', 'from before']]),
        caches: new Map([['transit-pages', new Map([[u('/'), `${OLD}||`]])]]),
      })
    try {
      // The service worker saved the home after the page started (the R9 race): the clean-up leaves it.
      localStorage.setItem('bft-transit-v1:1', 'saved since')
      await migrateOnce(Promise.resolve({ copies: new Map(), caches: new Map() }))
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBe('r7')
      expect(deleted).toEqual([])
      expect(localStorage.getItem('bft-transit-v1:1')).toBe('saved since')

      localStorage.clear()
      localStorage.setItem('bft-transit-v1:1', 'from before')
      await migrateOnce(fromBefore())
      expect(localStorage.getItem('bft-transit-v1:1')).toBeNull()
      expect(deleted).toEqual([`transit-pages ${u('/')}`])
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBe('r7')
      // Once only.
      localStorage.setItem('bft-transit-v1:1', 'from before')
      await migrateOnce(fromBefore())
      expect(localStorage.getItem('bft-transit-v1:1')).toBe('from before')
    } finally {
      ;(globalThis as { caches?: unknown }).caches = realCaches
      localStorage.clear()
    }
  })

  /** A fresh page: demo.tsx notes the device once per page load. */
  const freshPage = async () => {
    vi.resetModules()
    const { useFixtureCookie: hook } = await import('../src/demo.tsx')
    return function Allowed() {
      hook('bft_fixtures', false, false, true)
      return null
    }
  }

  it('demo data under any key counts as held: a device with only that is cleaned (Codex review r1)', async () => {
    localStorage.clear()
    localStorage.setItem(
      'bft-bus-offline:10802',
      JSON.stringify({ body: { staticGeneration: 'fixture-20261020' } }),
    )
    const Allowed = await freshPage()
    render(<Allowed />)
    await vi.waitFor(() => expect(localStorage.getItem('bft-demo-cleanup')).toBe('r7'))
    expect(localStorage.getItem('bft-bus-offline:10802')).toBeNull()
    localStorage.clear()
  })

  it('the hook notes the device before anything on the page is saved', async () => {
    localStorage.clear()
    const Allowed = await freshPage()
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
