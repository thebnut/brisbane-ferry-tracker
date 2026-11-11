/**
 * BrisbaneTransit's sitemap: an index over the landing page and every mode's own sitemap, built by that app's generator
 * with the mode prefix as its site URL, so each URL is the mounted page's canonical (`/ferry/`, `/bus/stop/10813`).
 *  - /sitemap.xml                  the index
 *  - /sitemaps/transit.xml         the landing page
 *  - /sitemaps/ferry.xml, train.xml  the standalone apps' sitemaps under /ferry and /train
 *  - /sitemaps/bus-pages.xml (no Nearby or Alerts: noindex), bus-routes.xml, bus-stops-n.xml  BrisbaneBus's, under /bus (stops and routes from client data)
 *  - /sitemaps/bus-directory.xml   the A–Z stop directory's pages (/bus/stops, /bus/stops/b, /bus/stops/b/2 …)
 * Each stop URL is listed once. `<lastmod>` is only a real change time: the timetable feed's date from each mode's
 * client data (@bft/core/seo feedDate), never today's date. The landing page and the bus info pages have none.
 */
import { STOPS_PER_SITEMAP, stopEntriesFromIndexText, urlsetXml } from '@bft/bus/app/lib/seo.ts'
import { directoryCounts, directoryPaths } from '@bft/bus/app/lib/stop-directory.ts'
import { routePath, stopPath } from '@bft/bus/app/lib/stops.ts'
import { ROUTE_SHORT_RE, RouteIndexFile } from '@bft/core/contract'
import { feedDate, generationOfText } from '@bft/core/seo'
import { sitemapXml as ferrySitemapXml } from '@bft/ferry/app/lib/seo.ts'
import { TERMINALS } from '@bft/ferry/app/lib/terminals.ts'
import { sitemapXml as trainSitemapXml } from '@bft/train/app/lib/seo.ts'
import { MODE_BASES } from '../app/lib/modes.ts'
import { POPULAR } from '../app/lib/popular.ts'
import { apiFetch } from '../app/lib/server.server.ts'

const xml = (body: string, maxAge = 86400) =>
  new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
    },
  })

const unavailable = () =>
  new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store' } })

const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Raw text of a client-data file through the API (null when it can't be read). */
async function dataText(env: Env, path: string): Promise<string | null> {
  const res = await apiFetch(env, path, { headers: { accept: 'application/json' } }).catch(() => null)
  return res?.ok ? res.text() : null
}

/** The feed date of a mode's client data (its stops.json generation), or null. */
async function modeFeedDate(env: Env, mode: 'ferry' | 'train', nowMs: number): Promise<string | null> {
  const text = await dataText(env, `/data/${mode}/stops.json`)
  return text ? feedDate(generationOfText(text), dateKey.format(nowMs)) : null
}

/** BrisbaneBus's sitemap files (its sitemapIndexXml), prefixed `bus-` in this site's /sitemaps/. */
function busFiles(stopCount: number): string[] {
  const files = ['/sitemaps/bus-pages.xml', '/sitemaps/bus-routes.xml']
  for (let i = 0; i * STOPS_PER_SITEMAP < stopCount; i++) files.push(`/sitemaps/bus-stops-${i + 1}.xml`)
  if (stopCount > 0) files.push('/sitemaps/bus-directory.xml')
  return files
}

export interface FeedDates {
  ferry?: string | null
  train?: string | null
  bus?: string | null
}

/** The index. A child file's `<lastmod>` is its mode's feed date when known; the landing page and bus pages have none. */
export function sitemapIndexXml(siteUrl: string, busStopCount: number, dates: FeedDates = {}): string {
  const files: [string, string | null | undefined][] = [
    ['/sitemaps/transit.xml', null],
    ['/sitemaps/ferry.xml', dates.ferry],
    ['/sitemaps/train.xml', dates.train],
    ...busFiles(busStopCount).map((f): [string, string | null | undefined] => [
      f,
      f === '/sitemaps/bus-pages.xml' ? null : dates.bus,
    ]),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files
  .map(
    ([f, lastmod]) =>
      `  <sitemap><loc>${esc(siteUrl + f)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`,
  )
  .join('\n')}
</sitemapindex>
`
}

/** The sitemap response for a /sitemap.xml or /sitemaps/* path, or null for any other (a 404 then). */
export async function sitemap(url: URL, env: Env, nowMs = Date.now()): Promise<Response | null> {
  const site = env.SITE_URL
  const bus = `${site}${MODE_BASES.bus}`
  const today = dateKey.format(nowMs)
  switch (url.pathname) {
    case '/sitemap.xml': {
      const [text, ferry, train] = await Promise.all([
        dataText(env, '/data/bus/stops.json'),
        modeFeedDate(env, 'ferry', nowMs),
        modeFeedDate(env, 'train', nowMs),
      ])
      // Without the stop index the bus stop files are left out of the index rather than the whole sitemap failing.
      const count = text ? stopEntriesFromIndexText(text).length : 0
      const busDate = text ? feedDate(generationOfText(text), today) : null
      return xml(sitemapIndexXml(site, count, { ferry, train, bus: busDate }), 3600)
    }
    case '/sitemaps/transit.xml':
      return xml(urlsetXml(site, ['/'], { changefreq: 'daily', priority: '1.0' }))
    case '/sitemaps/ferry.xml':
      return xml(
        ferrySitemapXml(`${site}${MODE_BASES.ferry}`, nowMs, await modeFeedDate(env, 'ferry', nowMs)),
      )
    case '/sitemaps/train.xml':
      return xml(
        trainSitemapXml(`${site}${MODE_BASES.train}`, nowMs, await modeFeedDate(env, 'train', nowMs)),
      )
    case '/sitemaps/bus-pages.xml':
      return xml(
        urlsetXml(bus, ['/', '/map', '/about'], {
          changefreq: 'daily',
          priority: '0.6',
        }),
      )
    case '/sitemaps/bus-routes.xml': {
      // Only routes whose page renders (the route index of the current publish), as BrisbaneBus's own sitemap.
      const text = await dataText(env, '/data/bus/routes.json')
      if (!text) return unavailable()
      let shorts: string[]
      let generation: string
      try {
        const index = RouteIndexFile.parse(JSON.parse(text))
        shorts = index.routes.filter((s) => ROUTE_SHORT_RE.test(s))
        generation = index.generation
      } catch {
        return unavailable()
      }
      return xml(
        urlsetXml(bus, [...new Set(shorts)].map(routePath), {
          changefreq: 'weekly',
          priority: '0.5',
          lastmod: feedDate(generation, today),
        }),
      )
    }
    case '/sitemaps/bus-directory.xml': {
      const text = await dataText(env, '/data/bus/stops.json')
      if (!text) return unavailable()
      const entries = stopEntriesFromIndexText(text)
      if (entries.length === 0) return unavailable()
      return xml(
        urlsetXml(bus, directoryPaths(directoryCounts(entries)), {
          changefreq: 'weekly',
          priority: '0.5',
          lastmod: feedDate(generationOfText(text), today),
        }),
      )
    }
  }
  const m = /^\/sitemaps\/bus-stops-(\d+)\.xml$/.exec(url.pathname)
  if (!m) return null
  const text = await dataText(env, '/data/bus/stops.json')
  if (!text) return unavailable()
  const n = Number(m[1])
  const keys = stopEntriesFromIndexText(text)
    .map((e) => e.key)
    .slice((n - 1) * STOPS_PER_SITEMAP, n * STOPS_PER_SITEMAP)
  if (n < 1 || keys.length === 0) return new Response('Not found', { status: 404 })
  return xml(
    urlsetXml(bus, keys.map(stopPath), {
      changefreq: 'daily',
      priority: '0.7',
      lastmod: feedDate(generationOfText(text), today),
    }),
  )
}

/** robots.txt: crawl everything but the fixtures once INDEXABLE is "1" (with the sitemap), else nothing. */
export function robotsTxt(siteUrl: string, indexable: boolean): string {
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /__fixtures/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
}

/**
 * /llms.txt (llmstxt.org): a short plain-text guide for AI assistants, which often cite this site's pages. What the site
 * is, its three sections and the pages people ask about most, all as canonical URLs on SITE_URL.
 */
export function llmsTxt(siteUrl: string): string {
  const link = (name: string, path: string, note?: string) =>
    `- [${name}](${siteUrl}${path})${note ? `: ${note}` : ''}`
  return [
    '# Brisbane Transit',
    '',
    "> Live departure boards for Brisbane's ferries (CityCat and cross-river), Queensland Rail trains in South East Queensland and Brisbane buses, from Translink's real-time and timetable data. Free, with no account.",
    '',
    'Every ferry terminal, train station and bus stop has its own page with its next departures: live times where the service reports them, the timetable otherwise. Brisbane Transit is not affiliated with Translink.',
    '',
    '## Sections',
    '',
    link('Ferry', `${MODE_BASES.ferry}/`, 'every Brisbane River ferry terminal'),
    link('Train', `${MODE_BASES.train}/`, 'every Queensland Rail station in South East Queensland'),
    link('All train stations A–Z', `${MODE_BASES.train}/stations`),
    link('Bus', `${MODE_BASES.bus}/`, 'any Brisbane bus stop, by name or stop number'),
    link('All bus stops A–Z', `${MODE_BASES.bus}/stops`),
    '',
    '## Ferry terminals',
    '',
    ...[...TERMINALS]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => link(t.name, `${MODE_BASES.ferry}/terminal/${t.slug}`)),
    '',
    '## Popular train stations',
    '',
    ...POPULAR.train.map((p) => link(p.name, p.href)),
    '',
    '## Popular bus stops',
    '',
    ...POPULAR.bus.map((p) => link(p.name, p.href)),
    '',
    '## Optional',
    '',
    link('Sitemap', '/sitemap.xml'),
    link("What's new", '/whats-new'),
    '',
  ].join('\n')
}
