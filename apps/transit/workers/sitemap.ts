/**
 * BrisbaneTransit's sitemap: an index over the landing page and every mode's own sitemap, built by that app's generator
 * with the mode prefix as its site URL, so each URL is the mounted page's canonical (`/ferry/`, `/bus/stop/10813`).
 *  - /sitemap.xml                  the index
 *  - /sitemaps/transit.xml         the landing page
 *  - /sitemaps/ferry.xml, train.xml  the standalone apps' sitemaps under /ferry and /train
 *  - /sitemaps/bus-pages.xml (no Nearby or Alerts: noindex), bus-routes.xml, bus-stops-n.xml  BrisbaneBus's, under /bus (stops and routes from client data)
 */
import { STOPS_PER_SITEMAP, stopKeysFromIndexText, urlsetXml } from '@bft/bus/app/lib/seo.ts'
import { routePath, stopPath } from '@bft/bus/app/lib/stops.ts'
import { ROUTE_SHORT_RE, RouteIndexFile } from '@bft/core/contract'
import { sitemapXml as ferrySitemapXml } from '@bft/ferry/app/lib/seo.ts'
import { sitemapXml as trainSitemapXml } from '@bft/train/app/lib/seo.ts'
import { MODE_BASES } from '../app/lib/modes.ts'
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

/** BrisbaneBus's sitemap files (its sitemapIndexXml), prefixed `bus-` in this site's /sitemaps/. */
function busFiles(stopCount: number): string[] {
  const files = ['/sitemaps/bus-pages.xml', '/sitemaps/bus-routes.xml']
  for (let i = 0; i * STOPS_PER_SITEMAP < stopCount; i++) files.push(`/sitemaps/bus-stops-${i + 1}.xml`)
  return files
}

export function sitemapIndexXml(siteUrl: string, busStopCount: number, nowMs: number): string {
  const today = dateKey.format(nowMs)
  const files = [
    '/sitemaps/transit.xml',
    '/sitemaps/ferry.xml',
    '/sitemaps/train.xml',
    ...busFiles(busStopCount),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((f) => `  <sitemap><loc>${esc(siteUrl + f)}</loc><lastmod>${today}</lastmod></sitemap>`).join('\n')}
</sitemapindex>
`
}

/** The sitemap response for a /sitemap.xml or /sitemaps/* path, or null for any other (a 404 then). */
export async function sitemap(url: URL, env: Env, nowMs = Date.now()): Promise<Response | null> {
  const site = env.SITE_URL
  const bus = `${site}${MODE_BASES.bus}`
  switch (url.pathname) {
    case '/sitemap.xml': {
      const text = await dataText(env, '/data/bus/stops.json')
      // Without the stop index the bus stop files are left out of the index rather than the whole sitemap failing.
      return xml(sitemapIndexXml(site, text ? stopKeysFromIndexText(text).length : 0, nowMs), 3600)
    }
    case '/sitemaps/transit.xml':
      return xml(urlsetXml(site, ['/'], { changefreq: 'daily', priority: '1.0' }))
    case '/sitemaps/ferry.xml':
      return xml(ferrySitemapXml(`${site}${MODE_BASES.ferry}`, nowMs))
    case '/sitemaps/train.xml':
      return xml(trainSitemapXml(`${site}${MODE_BASES.train}`, nowMs))
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
      try {
        shorts = RouteIndexFile.parse(JSON.parse(text)).routes.filter((s) => ROUTE_SHORT_RE.test(s))
      } catch {
        return unavailable()
      }
      return xml(urlsetXml(bus, shorts.map(routePath), { changefreq: 'weekly', priority: '0.5' }))
    }
  }
  const m = /^\/sitemaps\/bus-stops-(\d+)\.xml$/.exec(url.pathname)
  if (!m) return null
  const text = await dataText(env, '/data/bus/stops.json')
  if (!text) return unavailable()
  const n = Number(m[1])
  const keys = stopKeysFromIndexText(text).slice((n - 1) * STOPS_PER_SITEMAP, n * STOPS_PER_SITEMAP)
  if (n < 1 || keys.length === 0) return new Response('Not found', { status: 404 })
  return xml(urlsetXml(bus, keys.map(stopPath), { changefreq: 'daily', priority: '0.7' }))
}

/** robots.txt: crawl everything but the fixtures once INDEXABLE is "1" (with the sitemap), else nothing. */
export function robotsTxt(siteUrl: string, indexable: boolean): string {
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /__fixtures/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
}
