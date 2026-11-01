// @vitest-environment node
/** /sitemap.xml and /sitemaps/* (workers/sitemap.ts): every URL is a mounted page's canonical on this site. */
import { SCHEMA_VERSION } from '@bft/core/contract'
import { TERMINALS } from '@bft/ferry/app/lib/terminals.ts'
import { STATIONS } from '@bft/train/app/lib/network.ts'
import { describe, expect, it, vi } from 'vitest'
import worker from '../workers/app.ts'
import { sitemapIndexXml } from '../workers/sitemap.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

const SITE = 'https://brisbanetransit.com'
const NOW = Date.UTC(2026, 10, 2, 1)
const STOPS = JSON.stringify({
  stops: [
    { key: '10802', name: 'A' },
    { key: '1076', name: 'B' },
  ],
})
const ROUTES = JSON.stringify({
  schemaVersion: SCHEMA_VERSION,
  mode: 'bus',
  generation: 'g1',
  routes: ['66', 'P137', 'bad route'],
})

/** The API stub: the bus client data, or a 503 for every file when `down`. */
function envWith(down = false): Env {
  const api = async (req: Request) => {
    const path = new URL(req.url).pathname
    if (down) return new Response('down', { status: 503 })
    if (path === '/data/bus/stops.json') return new Response(STOPS)
    if (path === '/data/bus/routes.json') return new Response(ROUTES)
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
    ])
  })

  it('without the bus stop index, the index still answers (no stop files)', async () => {
    const res = await get('/sitemap.xml', envWith(true))
    expect(res.status).toBe(200)
    expect(locs(await res.text())).not.toContain(`${SITE}/sitemaps/bus-stops-1.xml`)
  })

  it('one bus stop file per 5000 stops', () => {
    expect(locs(sitemapIndexXml(SITE, 10_001, NOW)).filter((l) => l.includes('bus-stops'))).toHaveLength(3)
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
    expect(train.slice(0, 3)).toEqual([`${SITE}/train/`, `${SITE}/train/stations`, `${SITE}/train/alerts`])
    expect(train).toHaveLength(STATIONS.length + 3)
    for (const u of [...ferry, ...train]) expect(u.startsWith(`${SITE}/`), u).toBe(true)
  })

  it('bus: pages, the routes that render and the stops, under /bus', async () => {
    expect(locs(await (await get('/sitemaps/bus-pages.xml')).text())).toEqual([
      `${SITE}/bus/`,
      `${SITE}/bus/nearby`,
      `${SITE}/bus/alerts`,
      `${SITE}/bus/map`,
      `${SITE}/bus/about`,
    ])
    expect(locs(await (await get('/sitemaps/bus-routes.xml')).text())).toEqual([
      `${SITE}/bus/route/66`,
      `${SITE}/bus/route/P137`,
    ])
    expect(locs(await (await get('/sitemaps/bus-stops-1.xml')).text())).toEqual([
      `${SITE}/bus/stop/10802`,
      `${SITE}/bus/stop/1076`,
    ])
  })

  it('a stop file past the end is a 404; unreadable bus data is a 503 crawlers retry', async () => {
    expect((await get('/sitemaps/bus-stops-2.xml')).status).toBe(404)
    expect((await get('/sitemaps/bus-stops-0.xml')).status).toBe(404)
    expect((await get('/sitemaps/bus-stops-1.xml', envWith(true))).status).toBe(503)
    expect((await get('/sitemaps/bus-routes.xml', envWith(true))).status).toBe(503)
  })
})
