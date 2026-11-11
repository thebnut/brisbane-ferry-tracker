// @vitest-environment node
/** /sitemap.xml and /sitemaps/* (workers/sitemap.ts): every URL is a mounted page's canonical on this site. */
import { SCHEMA_VERSION } from '@bft/core/contract'
import { TERMINALS } from '@bft/ferry/app/lib/terminals.ts'
import { STATIONS } from '@bft/train/app/lib/network.ts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import worker from '../workers/app.ts'
import { sitemapIndexXml } from '../workers/sitemap.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

const SITE = 'https://brisbanetransit.com'
const NOW = Date.UTC(2026, 10, 2, 1) // 11 am, 2 Nov 2026 in Brisbane
const GEN = '20261030-20270109-a0e837e2-72f9f901b555'
const stop = (key: string, name: string, extra: object = {}) => ({
  key,
  name,
  lat: -27.4,
  lon: 153,
  routes: ['66'],
  code: key.padStart(6, '0'),
  ...extra,
})
/** As data/bus/stops.json: a busway station's `boardAt` names its platforms, which are stops of their own too. */
const STOPS = JSON.stringify({
  schemaVersion: SCHEMA_VERSION,
  mode: 'bus',
  generation: GEN,
  stops: [
    stop('10802', 'Cultural Centre station, platform 1'),
    stop('1076', 'Boundary Rd at Bardon'),
    stop('10794', 'Roma Street busway station', {
      boardAt: [
        { key: '10793', name: 'Roma Street busway, platform 1' },
        { key: '10802', name: 'Cultural Centre station, platform 1' },
      ],
    }),
    stop('10793', 'Roma Street busway, platform 1'),
  ],
})
const ROUTES = JSON.stringify({
  schemaVersion: SCHEMA_VERSION,
  mode: 'bus',
  generation: GEN,
  routes: ['66', 'P137', 'bad route', '66'],
})
const MODE_STOPS = (mode: string, generation: string) =>
  JSON.stringify({ schemaVersion: SCHEMA_VERSION, mode, generation, stops: [] })

/** The API stub: the bus client data, or a 503 for every file when `down`. */
function envWith(down = false): Env {
  const api = async (req: Request) => {
    const path = new URL(req.url).pathname
    if (down) return new Response('down', { status: 503 })
    if (path === '/data/bus/stops.json') return new Response(STOPS)
    if (path === '/data/bus/routes.json') return new Response(ROUTES)
    if (path === '/data/ferry/stops.json') return new Response(MODE_STOPS('ferry', GEN))
    // A feed date after today (2 Nov) is never a lastmod.
    if (path === '/data/train/stops.json') return new Response(MODE_STOPS('train', '20261201-x-y-z'))
    return new Response('not found', { status: 404 })
  }
  return {
    SITE_URL: SITE,
    API_BASE: 'http://x',
    INDEXABLE: '1',
    API: { fetch: vi.fn(api) } as unknown as Fetcher,
  } as unknown as Env
}
const get = (path: string, env = envWith()) =>
  worker.fetch(new Request(`${SITE}${path}`), env, {} as ExecutionContext) as Promise<Response>
const locs = (body: string) => [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string)

describe('sitemap', () => {
  // "Today" is 2 Nov 2026 (Brisbane): only Date is faked, so the Worker's fetches and timers run as normal.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('the index lists the landing page and every mode file, all on this site', async () => {
    const res = await get('/sitemap.xml')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(res.headers.get('x-robots-tag')).toBeNull()
    const body = await res.text()
    expect(body).toContain('<sitemapindex')
    expect(locs(body)).toEqual([
      `${SITE}/sitemaps/transit.xml`,
      `${SITE}/sitemaps/ferry.xml`,
      `${SITE}/sitemaps/train.xml`,
      `${SITE}/sitemaps/bus-pages.xml`,
      `${SITE}/sitemaps/bus-routes.xml`,
      `${SITE}/sitemaps/bus-stops-1.xml`,
      `${SITE}/sitemaps/bus-directory.xml`,
    ])
    // lastmod only from the data's feed date: none for the landing page, the bus info pages, or a future feed date.
    expect(body).toContain(`<loc>${SITE}/sitemaps/transit.xml</loc></sitemap>`)
    expect(body).toContain(`<loc>${SITE}/sitemaps/ferry.xml</loc><lastmod>2026-10-30</lastmod>`)
    expect(body).toContain(`<loc>${SITE}/sitemaps/train.xml</loc></sitemap>`)
    expect(body).toContain(`<loc>${SITE}/sitemaps/bus-pages.xml</loc></sitemap>`)
    expect(body).toContain(`<loc>${SITE}/sitemaps/bus-stops-1.xml</loc><lastmod>2026-10-30</lastmod>`)
    expect(body).not.toContain('<lastmod>2026-11-02</lastmod>')
  })

  it('without the bus stop index, the index still answers (no stop files)', async () => {
    const res = await get('/sitemap.xml', envWith(true))
    expect(res.status).toBe(200)
    expect(locs(await res.text())).not.toContain(`${SITE}/sitemaps/bus-stops-1.xml`)
  })

  it('one bus stop file per 5000 stops', () => {
    expect(locs(sitemapIndexXml(SITE, 10_001)).filter((l) => l.includes('bus-stops'))).toHaveLength(3)
  })

  it('the landing page', async () => {
    expect(locs(await (await get('/sitemaps/transit.xml')).text())).toEqual([`${SITE}/`])
  })

  it('ferry and train: the standalone sitemaps under their prefix (home is the prefix with a slash, as its canonical)', async () => {
    const ferry = locs(await (await get('/sitemaps/ferry.xml')).text())
    expect(ferry[0]).toBe(`${SITE}/ferry/`)
    expect(ferry).toContain(`${SITE}/ferry/terminal/${TERMINALS[0]?.slug}`)
    expect(ferry).toContain(`${SITE}/ferry/privacy`)
    expect(ferry).toHaveLength(TERMINALS.length + 3)
    const train = locs(await (await get('/sitemaps/train.xml')).text())
    // No Alerts (noindex): it changes by the minute.
    expect(train.slice(0, 2)).toEqual([`${SITE}/train/`, `${SITE}/train/stations`])
    expect(train).not.toContain(`${SITE}/train/alerts`)
    expect(train).toHaveLength(STATIONS.length + 2)
    for (const u of [...ferry, ...train]) expect(u.startsWith(`${SITE}/`), u).toBe(true)
  })

  it('bus: pages, the routes that render and the stops, under /bus', async () => {
    expect(locs(await (await get('/sitemaps/bus-pages.xml')).text())).toEqual([
      `${SITE}/bus/`,
      `${SITE}/bus/map`,
      `${SITE}/bus/about`,
    ])
    expect(locs(await (await get('/sitemaps/bus-routes.xml')).text())).toEqual([
      `${SITE}/bus/route/66`,
      `${SITE}/bus/route/P137`,
    ])
    // Each stop once: the stops a busway station's boardAt names are not listed again (97 were, live, before).
    expect(locs(await (await get('/sitemaps/bus-stops-1.xml')).text())).toEqual([
      `${SITE}/bus/stop/10802`,
      `${SITE}/bus/stop/1076`,
      `${SITE}/bus/stop/10794`,
      `${SITE}/bus/stop/10793`,
    ])
  })

  it('bus stop directory: the A–Z page and each letter with stops', async () => {
    const body = await (await get('/sitemaps/bus-directory.xml')).text()
    expect(locs(body)).toEqual([
      `${SITE}/bus/stops`,
      `${SITE}/bus/stops/b`,
      `${SITE}/bus/stops/c`,
      `${SITE}/bus/stops/r`,
    ])
    expect(body).toContain('<lastmod>2026-10-30</lastmod>')
    expect((await get('/sitemaps/bus-directory.xml', envWith(true))).status).toBe(503)
  })

  it('no URL is listed twice, in any file or across files', async () => {
    const files = locs(await (await get('/sitemap.xml')).text())
    const all: string[] = []
    for (const f of files) all.push(...locs(await (await get(new URL(f).pathname)).text()))
    expect(all.length).toBeGreaterThan(TERMINALS.length + STATIONS.length)
    expect(new Set(all).size).toBe(all.length)
  })

  it('stop and route files carry the feed date; ferry and train their own (none when it is in the future)', async () => {
    expect(await (await get('/sitemaps/bus-stops-1.xml')).text()).toContain('<lastmod>2026-10-30</lastmod>')
    expect(await (await get('/sitemaps/bus-routes.xml')).text()).toContain('<lastmod>2026-10-30</lastmod>')
    expect(await (await get('/sitemaps/bus-pages.xml')).text()).not.toContain('<lastmod>')
    const ferry = await (await get('/sitemaps/ferry.xml')).text()
    expect(ferry).toContain('<lastmod>2026-10-30</lastmod>')
    expect(ferry).not.toMatch(/<lastmod>2026-11-0\d<\/lastmod>/)
    expect(await (await get('/sitemaps/train.xml')).text()).not.toContain('<lastmod>')
  })

  it('a stop file past the end is a 404; unreadable bus data is a 503 crawlers retry', async () => {
    expect((await get('/sitemaps/bus-stops-2.xml')).status).toBe(404)
    expect((await get('/sitemaps/bus-stops-0.xml')).status).toBe(404)
    expect((await get('/sitemaps/bus-stops-1.xml', envWith(true))).status).toBe(503)
    expect((await get('/sitemaps/bus-routes.xml', envWith(true))).status).toBe(503)
  })
})

describe('/llms.txt', () => {
  it('plain text: what the site is, its sections and the main terminals, stations and stops, all on this site', async () => {
    const res = await get('/llms.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const body = await res.text()
    expect(body.startsWith('# Brisbane Transit\n\n> ')).toBe(true)
    for (const path of ['/ferry/', '/train/', '/bus/', '/train/stations', '/bus/stops', '/sitemap.xml'])
      expect(body).toContain(`](${SITE}${path})`)
    for (const t of TERMINALS) expect(body).toContain(`[${t.name}](${SITE}/ferry/terminal/${t.slug})`)
    expect(body).toContain(`(${SITE}/train/station/central)`)
    expect(body).toContain(`(${SITE}/bus/stop/10802)`)
    const links = [...body.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1] as string)
    for (const u of links) expect(u.startsWith(`${SITE}/`), u).toBe(true)
    // Short: a guide, not a dump of the sitemap.
    expect(body.length).toBeLessThan(5000)
  })
})
