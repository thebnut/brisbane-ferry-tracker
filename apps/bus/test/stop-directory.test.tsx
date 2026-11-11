// @vitest-environment jsdom
/**
 * The A–Z stop directory (/stops, /stops/:letter, /stops/:letter/:page): built from data/bus/stops.json, every stop's
 * page as a real link in the server HTML, paged, each page its own canonical; a 404 for anything else.
 */
import { renderToString } from 'react-dom/server'
import { createRoutesStub, RouterContextProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { stopEntriesFromIndexText } from '../app/lib/seo.ts'
import { resetDirectoryCache } from '../app/lib/stop-directory.server.ts'
import {
  buildDirectory,
  DIRECTORY_PAGE_SIZE,
  directoryCounts,
  directoryLetter,
  directoryPath,
  directoryPaths,
  parseDirectoryParams,
} from '../app/lib/stop-directory.ts'
import Stops, { directoryMeta, loader, meta } from '../app/routes/stops.tsx'

const stop = (key: string, name: string, extra: object = {}) => ({
  key,
  name,
  lat: -27.4,
  lon: 153,
  routes: ['66'],
  code: key.padStart(6, '0'),
  ...extra,
})

/** 1,101 stops on B (three pages), two on A, one starting with a digit; the busway station's boardAt repeats stops. */
function indexText(): string {
  const stops = [
    stop('2', 'Adelaide Street Stop 37'),
    stop('1', 'Ann Street Stop 11'),
    stop('3', '1 William St'),
    stop('10794', 'Roma Street busway station', {
      boardAt: [{ key: '1', name: 'Ann Street Stop 11' }],
    }),
  ]
  for (let i = 0; i < 2 * DIRECTORY_PAGE_SIZE + 101; i++) stops.push(stop(String(100 + i), `Bus Rd ${i}`))
  return JSON.stringify({ schemaVersion: 1, mode: 'bus', generation: '20261110-x', stops })
}

function envWith(text: string | null) {
  return {
    SITE_URL: 'https://bus.test',
    API_BASE: 'https://api.test',
    FIXTURES: '0',
    ASSETS: { fetch: async () => new Response('', { status: 404 }) },
    API: {
      fetch: async (req: Request) =>
        new URL(req.url).pathname === '/data/bus/stops.json' && text !== null
          ? new Response(text)
          : new Response('{"error":"boom"}', { status: 500 }),
    },
  } as unknown as Env
}

const ctx = (env: Env) => {
  const c = new RouterContextProvider()
  c.set(cloudflareContext, { env, ctx: {} as ExecutionContext, nonce: 'n' })
  return c
}

async function load(path: string, text: string | null = indexText()) {
  const m = /^\/stops(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path)
  const params = { letter: m?.[1], page: m?.[2] }
  return loader({
    request: new Request(`https://bus.test${path}`),
    context: ctx(envWith(text)),
    params,
  } as never)
}

/** Status of a thrown or returned loader response (a data() or redirect()). */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    const r = (await p) as { init?: { status?: number } } | Response
    return r instanceof Response ? r.status : (r?.init?.status ?? 200)
  } catch (e) {
    const r = e as { init?: { status?: number } } | Response
    return r instanceof Response ? r.status : (r?.init?.status ?? 500)
  }
}

beforeEach(() => resetDirectoryCache())

describe('stop entries from the index', () => {
  it('each stop once, index entries only (a station boardAt list repeats stops: 97 duplicate sitemap URLs live)', () => {
    const keys = stopEntriesFromIndexText(indexText()).map((e) => e.key)
    expect(keys.slice(0, 4)).toEqual(['2', '1', '3', '10794'])
    expect(new Set(keys).size).toBe(keys.length)
    expect(stopEntriesFromIndexText('not json')).toEqual([])
    expect(stopEntriesFromIndexText('{"stops":{}}')).toEqual([])
  })
})

describe('directory', () => {
  it('groups by first letter (digits and symbols together), sorted by name', () => {
    expect(directoryLetter('Ann St')).toBe('a')
    expect(directoryLetter(' boundary Rd')).toBe('b')
    expect(directoryLetter('1 William St')).toBe('0-9')
    expect(directoryLetter("'Ekka' stop")).toBe('0-9')
    const dir = buildDirectory(stopEntriesFromIndexText(indexText()))
    expect([...dir.keys()]).toEqual(['a', 'b', 'r', '0-9'])
    expect(dir.get('a')?.map((s) => s.name)).toEqual(['Adelaide Street Stop 37', 'Ann Street Stop 11'])
    // Numeric order within names (Bus Rd 2 before Bus Rd 10).
    expect(
      dir
        .get('b')
        ?.slice(0, 3)
        .map((s) => s.name),
    ).toEqual(['Bus Rd 0', 'Bus Rd 1', 'Bus Rd 2'])
  })

  it('paths: page 1 is the bare letter; the sitemap lists every page', () => {
    expect(directoryPath()).toBe('/stops')
    expect(directoryPath('b')).toBe('/stops/b')
    expect(directoryPath('b', 1)).toBe('/stops/b')
    expect(directoryPath('b', 3)).toBe('/stops/b/3')
    const counts = directoryCounts(stopEntriesFromIndexText(indexText()))
    expect(directoryPaths(counts)).toEqual([
      '/stops',
      '/stops/a',
      '/stops/b',
      '/stops/b/2',
      '/stops/b/3',
      '/stops/r',
      '/stops/0-9',
    ])
  })

  it.each([
    [undefined, undefined, { letter: null, page: 1, redirect: false }],
    ['b', undefined, { letter: 'b', page: 1, redirect: false }],
    ['b', '2', { letter: 'b', page: 2, redirect: false }],
    ['0-9', undefined, { letter: '0-9', page: 1, redirect: false }],
    ['B', undefined, { letter: 'b', page: 1, redirect: true }],
    ['b', '1', { letter: 'b', page: 1, redirect: true }],
    ['b', '02', { letter: 'b', page: 2, redirect: true }],
    ['bb', undefined, null],
    ['b', '0', null],
    ['b', 'x', null],
    ['b', '99999', null],
    ['%2F', undefined, null],
  ] as const)('params %s %s', (letter, page, want) => {
    expect(parseDirectoryParams(letter, page)).toEqual(want)
  })
})

describe('loader', () => {
  it('the A–Z page: every letter with its count', async () => {
    const d = (await load('/stops')) as { letters: { letter: string; count: number }[]; stops: unknown[] }
    expect(d.letters).toEqual([
      { letter: 'a', count: 2 },
      { letter: 'b', count: 2 * DIRECTORY_PAGE_SIZE + 101 },
      { letter: 'r', count: 1 },
      { letter: '0-9', count: 1 },
    ])
    expect(d.stops).toEqual([])
  })

  it('a letter page: its slice of stops and how many pages', async () => {
    const p1 = (await load('/stops/b')) as { stops: { id: string }[]; pages: number; page: number }
    expect(p1.pages).toBe(3)
    expect(p1.stops).toHaveLength(DIRECTORY_PAGE_SIZE)
    const p3 = (await load('/stops/b/3')) as { stops: { id: string }[]; page: number }
    expect(p3.page).toBe(3)
    expect(p3.stops).toHaveLength(101)
  })

  it('404 for an unknown letter, a letter with no stops, or a page past the end', async () => {
    for (const path of ['/stops/bb', '/stops/z', '/stops/b/4', '/stops/a/2', '/stops/b/0'])
      expect(await statusOf(load(path)), path).toBe(404)
  })

  it('301 to the canonical spelling', async () => {
    for (const [path, to] of [
      ['/stops/B', '/stops/b'],
      ['/stops/b/1', '/stops/b'],
      ['/stops/b/02', '/stops/b/2'],
    ]) {
      let thrown: unknown
      try {
        await load(path as string)
      } catch (e) {
        thrown = e
      }
      expect(thrown instanceof Response && thrown.status).toBe(301)
      expect((thrown as Response).headers.get('location')).toBe(to)
    }
  })

  it('the stop index unreadable: a 503 page that says so (noindex), never an empty directory', async () => {
    const r = (await load('/stops/b', null)) as { data: { unavailable: boolean }; init: { status: number } }
    expect(r.init.status).toBe(503)
    expect(r.data.unavailable).toBe(true)
    const tags = meta({ loaderData: r.data } as never) as Record<string, string>[]
    expect(tags).toContainEqual({ name: 'robots', content: 'noindex' })
    expect(tags.find((t) => t.rel === 'canonical')).toBeUndefined()
  })
})

describe('meta', () => {
  it('each page its own title, description and canonical', async () => {
    const tags = (_path: string, d: unknown) => meta({ loaderData: d } as never) as Record<string, string>[]
    const index = tags('/stops', await load('/stops'))
    expect(index.find((t) => t.rel === 'canonical')?.href).toBe('https://bus.test/stops')
    expect(index.find((t) => t.name === 'robots')).toBeUndefined()
    const b2 = tags('/stops/b/2', await load('/stops/b/2'))
    expect(b2.find((t) => t.rel === 'canonical')?.href).toBe('https://bus.test/stops/b/2')
    const titles = new Set(
      [index, b2, tags('/stops/b', await load('/stops/b'))].map((t) => t.find((x) => x.title)?.title),
    )
    expect(titles.size).toBe(3)
    const m = directoryMeta('b', 2, 3, [
      { id: '1', name: 'Bus Rd 500' },
      { id: '2', name: 'Bus Rd 999' },
    ])
    expect(m.title).toBe('Bus stops: B (page 2 of 3) | BrisbaneBus')
    expect(m.title.length).toBeLessThanOrEqual(60)
    expect(m.description).toContain('from Bus Rd 500 to Bus Rd 999')
    expect(m.description.length).toBeLessThanOrEqual(160)
  })
})

describe('server HTML', () => {
  async function html(path: string): Promise<string> {
    const loaderData = await load(path)
    const Stub = createRoutesStub([
      { path: '/stops/:letter?/:page?', Component: Stops as never, loader: () => loaderData },
    ])
    // Rendered on the server after the loader ran: the links are in the first HTML, no JavaScript needed.
    const { hydrationData } = { hydrationData: { loaderData: { 0: loaderData } } }
    return renderToString(<Stub initialEntries={[path]} hydrationData={hydrationData as never} />)
  }

  it('the A–Z page links every letter page', async () => {
    const out = await html('/stops')
    for (const l of ['a', 'b', 'r', '0-9']) expect(out).toContain(`href="/stops/${l}"`)
  })

  it("a letter page links each of its stops' pages and the other pages", async () => {
    const out = await html('/stops/b/2')
    const links = [...out.matchAll(/href="\/stop\/(\d+)"/g)].map((m) => m[1])
    expect(links).toHaveLength(DIRECTORY_PAGE_SIZE)
    expect(out).toContain('href="/stops/b"')
    expect(out).toContain('href="/stops/b/3"')
  })
})
