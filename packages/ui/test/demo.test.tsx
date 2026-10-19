// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  DemoExitLink,
  FIXTURE_COOKIE_MAX_AGE_S,
  fixtureCookie,
  isDemoSession,
  useFixtureCookie,
} from '../src/demo.tsx'
import { withLocks } from './locks.ts'

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

/** An in-memory Cache Storage that records what it deletes ("cache url"). */
function fakeCaches(init: Record<string, string[]>) {
  const store = new Map(Object.entries(init).map(([n, urls]) => [n, new Set(urls.map((x) => u(x)))]))
  const deleted: string[] = []
  const storage = {
    keys: async () => [...store.keys()],
    open: async (name: string) => {
      const entries = store.get(name) ?? new Set<string>()
      store.set(name, entries)
      return {
        keys: async () => [...entries].map((url) => new Request(url)),
        delete: async (req: Request) => {
          deleted.push(`${name} ${new URL(req.url).pathname}`)
          return entries.delete(req.url)
        },
      }
    },
  } as unknown as CacheStorage
  return { storage, deleted, store }
}
const u = (path: string) => `https://transit.example${path}`
const withCaches = async (storage: CacheStorage, run: () => Promise<void>) => {
  const g = globalThis as { caches?: unknown }
  const real = g.caches
  g.caches = storage
  try {
    await run()
  } finally {
    g.caches = real
    localStorage.clear()
  }
}

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
    const { storage, deleted } = fakeCaches({
      'workbox-precache-v2-x': ['/assets/a.js'],
      'bus-pages': ['/stop/1'],
      'bus-data': ['/v1/x'],
    })
    const resave = vi.fn(async () => {})
    expect(await clearDemoLeftovers({}, localStorage, storage, resave)).toBe(1)
    expect(localStorage.getItem('bft-bus-v1:10802')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).not.toBeNull()
    expect(deleted).toEqual(['bus-pages /stop/1', 'bus-data /v1/x'])
    expect(resave).toHaveBeenCalledTimes(1)
    deleted.length = 0
    expect(await clearDemoLeftovers({}, localStorage, storage, resave)).toBe(0)
    expect(deleted).toEqual([])
    // The one-off clean-up where demo mode is allowed: every offline copy (train's carry no generation).
    localStorage.setItem('bft-train-offline:central:', JSON.stringify({ day: '20261020', rows: [] }))
    await clearDemoLeftovers({ all: true }, localStorage, storage, resave)
    expect(localStorage.getItem('bft-train-offline:central:')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).toBeNull()
    expect(localStorage.getItem('bft-bus-saved')).toBe('[]')
    // Nothing was left to delete: no re-save.
    expect(resave).toHaveBeenCalledTimes(1)
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

const granted = { lock: Promise.resolve(() => {}) }

describe('the one-off clean-up removes only what the device held when the page started (R9)', () => {
  it('an offline copy written since the first render stays; demo data goes wherever it is', async () => {
    const { clearDemoLeftovers } = await import('../src/demo-cleanup.ts')
    localStorage.setItem('bft-train-offline:central:', 'old day')
    localStorage.setItem('bft-bus-v1:1', 'rewritten since')
    localStorage.setItem('bft-ferry-v1:2', 'saved since')
    localStorage.setItem('bft-ferry-v1:3', JSON.stringify({ generation: 'fixture-20261020' }))
    localStorage.setItem('bft-bus-saved', '[]')
    const start = {
      copies: new Map([
        ['bft-train-offline:central:', 'old day'],
        ['bft-bus-v1:1', 'old copy'],
      ]),
    }
    const { storage } = fakeCaches({})
    expect(await clearDemoLeftovers({ all: true, start }, localStorage, storage, async () => {})).toBe(2)
    expect(localStorage.getItem('bft-train-offline:central:')).toBeNull()
    expect(localStorage.getItem('bft-ferry-v1:3')).toBeNull()
    expect(localStorage.getItem('bft-bus-v1:1')).toBe('rewritten since')
    expect(localStorage.getItem('bft-ferry-v1:2')).toBe('saved since')
    expect(localStorage.getItem('bft-bus-saved')).toBe('[]')
    localStorage.clear()
  })

  it('a fresh device only records that it is done; an older one is cleaned once', async () => {
    const { DEMO_MIGRATION_KEY, migrateOnce } = await import('../src/demo-cleanup.ts')
    const fresh = fakeCaches({})
    await withCaches(fresh.storage, async () => {
      await migrateOnce({ copies: new Map(), ...granted })
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBe('r7')
      expect(fresh.deleted).toEqual([])
    })
    const older = fakeCaches({ 'workbox-precache-v2-x': ['/assets/a.js'], 'transit-pages': ['/'] })
    await withCaches(older.storage, async () => {
      localStorage.setItem('bft-transit-v1:1', 'from before')
      const start = { copies: new Map([['bft-transit-v1:1', 'from before']]), ...granted }
      await migrateOnce(start)
      expect(localStorage.getItem('bft-transit-v1:1')).toBeNull()
      expect(older.deleted).toEqual(['transit-pages /'])
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBe('r7')
      // Once only.
      localStorage.setItem('bft-transit-v1:1', 'from before')
      await migrateOnce(start)
      expect(localStorage.getItem('bft-transit-v1:1')).toBe('from before')
    })
  })

  it('without the lock (a write was in progress) it does nothing and tries again next time', async () => {
    const { DEMO_MIGRATION_KEY, migrateOnce } = await import('../src/demo-cleanup.ts')
    const { storage, deleted } = fakeCaches({ 'transit-pages': ['/'] })
    await withCaches(storage, async () => {
      localStorage.setItem('bft-transit-v1:1', 'from before')
      await migrateOnce({
        copies: new Map([['bft-transit-v1:1', 'from before']]),
        lock: Promise.resolve(null),
      })
      expect(deleted).toEqual([])
      expect(localStorage.getItem('bft-transit-v1:1')).toBe('from before')
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBeNull()
    })
  })

  it('out of time it stops before its next deletion and is not marked done (Codex review r3)', async () => {
    const { DEMO_MIGRATION_KEY, migrateOnce } = await import('../src/demo-cleanup.ts')
    const { storage, deleted } = fakeCaches({ 'transit-pages': ['/', '/ferry'], 'transit-data': ['/v1/x'] })
    await withCaches(storage, async () => {
      // Each step takes 1 ms of a 2 ms budget: the listing, then one deletion, then time is up.
      let t = 0
      await migrateOnce({ copies: new Map(), ...granted }, 2, () => t++)
      expect(deleted).toEqual(['transit-pages /'])
      expect(localStorage.getItem(DEMO_MIGRATION_KEY)).toBeNull()
    })
  })

  it('leaving demo mode drops its leftovers while holding back writers', async () => {
    const { leaveDemo } = await import('../src/demo-cleanup.ts')
    const { storage, deleted } = fakeCaches({ 'bus-pages': ['/stop/1'] })
    await withCaches(storage, async () => {
      localStorage.setItem('bft-bus-v1:1', JSON.stringify({ generation: 'fixture-20261020' }))
      await withLocks(leaveDemo)
      expect(localStorage.getItem('bft-bus-v1:1')).toBeNull()
      expect(deleted).toEqual(['bus-pages /stop/1'])
    })
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
    await withLocks(async () => {
      const Allowed = await freshPage()
      render(<Allowed />)
      await vi.waitFor(() => expect(localStorage.getItem('bft-demo-cleanup')).toBe('r7'))
    })
    expect(localStorage.getItem('bft-bus-offline:10802')).toBeNull()
    localStorage.clear()
  })

  it('without Web Locks, or when the request fails, nothing is removed and it is not marked done (Codex review r5)', async () => {
    const { holdCacheLock } = await import('../src/connectivity.ts')
    const nav = navigator as unknown as { locks?: unknown }
    const real = nav.locks
    for (const locks of [undefined, { request: () => Promise.reject(new Error('SecurityError')) }]) {
      Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
      try {
        expect(await holdCacheLock('exclusive')).toBeNull()
        localStorage.clear()
        localStorage.setItem('bft-ferry-v1:1', 'saved before')
        const { storage, deleted } = fakeCaches({ 'transit-pages': ['/'] })
        await withCaches(storage, async () => {
          const Allowed = await freshPage()
          render(<Allowed />)
          await new Promise((r) => setTimeout(r, 50))
          expect(localStorage.getItem('bft-demo-cleanup')).toBeNull()
          expect(localStorage.getItem('bft-ferry-v1:1')).toBe('saved before')
          expect(deleted).toEqual([])
          // Leaving demo mode still drops demo copies, but leaves Cache Storage alone.
          localStorage.setItem('bft-bus-v1:2', JSON.stringify({ generation: 'fixture-20261020' }))
          const { leaveDemo } = await import('../src/demo-cleanup.ts')
          await leaveDemo()
          expect(localStorage.getItem('bft-bus-v1:2')).toBeNull()
          expect(deleted).toEqual([])
        })
      } finally {
        Object.defineProperty(navigator, 'locks', { value: real, configurable: true })
      }
    }
  })

  it('a first render that never commits still runs the clean-up and lets the writers go (Codex review r4)', async () => {
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      render() {
        return this.state.failed ? <p>fallback</p> : this.props.children
      }
    }
    await withLocks(async () => {
      localStorage.clear()
      vi.resetModules()
      const { useFixtureCookie: hook } = await import('../src/demo.tsx')
      const { holdCacheLock } = await import('../src/connectivity.ts')
      function Broken(): ReactNode {
        hook('bft_fixtures', false, false, true)
        throw new Error('render failed')
      }
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(
          <Boundary>
            <Broken />
          </Boundary>,
        )
        expect(screen.getByText('fallback')).toBeTruthy()
        await vi.waitFor(() => expect(localStorage.getItem('bft-demo-cleanup')).toBe('r7'))
        await vi.waitFor(async () => {
          const release = await holdCacheLock('exclusive', true)
          expect(release).not.toBeNull()
          release?.()
        })
      } finally {
        quiet.mockRestore()
        localStorage.clear()
      }
    })
  })

  it('the hook notes the device before anything on the page is saved', async () => {
    localStorage.clear()
    await withLocks(async () => {
      const Allowed = await freshPage()
      render(<Allowed />)
      // A board writes its copy once the page has rendered.
      localStorage.setItem('bft-ferry-v1:1', 'first visit')
      await vi.waitFor(() => expect(localStorage.getItem('bft-demo-cleanup')).toBe('r7'))
    })
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
