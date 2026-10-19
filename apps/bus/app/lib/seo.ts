/** Titles, descriptions, canonicals, OG tags, JSON-LD and the sitemap index for BrisbaneBus. */
import { stopCode, stopPath } from './stops.ts'

export const SITE_URL = 'https://bft-bus.brisbanetransit.workers.dev'
export const SITE_NAME = 'BrisbaneBus'

export const HOME_META = {
  title: 'BrisbaneBus - live Brisbane bus departures by stop',
  description:
    'Live departure boards for every Brisbane bus stop and busway platform: search by stop name or number, find stops near you, and see Metro, CityGlider and BUZ services in real time.',
}

export const ATTRIBUTION = {
  text: 'Based on TransLink data provided by the State of Queensland (Department of Transport and Main Roads)',
  licenceName: 'Creative Commons Attribution 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

export function stopMetaTags(stopId: string, name: string, routes: string[], siteUrl = SITE_URL) {
  const code = stopCode(stopId)
  const routeText = routes.length
    ? ` Routes ${routes.slice(0, 8).join(', ')}${routes.length > 8 ? ' and more' : ''}.`
    : ''
  return {
    title: `${name}${code ? ` (stop ${code})` : ''} - next buses, live times | ${SITE_NAME}`,
    description: `Live bus departures from ${name}, Brisbane${code ? `, stop ${code}` : ''}.${routeText} Real-time TransLink updates every 15 seconds.`,
    url: `${siteUrl}${stopPath(stopId)}`,
  }
}

export function routeMetaTags(short: string, long: string | undefined, siteUrl = SITE_URL) {
  return {
    title: `Route ${short}${long ? ` ${long}` : ''} - live buses and stops | ${SITE_NAME}`,
    description: `Every stop on Brisbane bus route ${short}${long ? ` (${long})` : ''}, with live bus positions and departures from each stop.`,
    url: `${siteUrl}/route/${encodeURIComponent(short)}`,
  }
}

/** Head tags shared by every page: canonical/noindex, OG and Twitter cards. */
export function pageMeta(opts: {
  title: string
  description: string
  url: string
  noindex?: boolean
  siteUrl?: string
}) {
  const siteUrl = opts.siteUrl ?? SITE_URL
  return [
    { title: opts.title },
    { name: 'description', content: opts.description },
    opts.noindex
      ? { name: 'robots', content: 'noindex' }
      : { tagName: 'link', rel: 'canonical', href: opts.url },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: 'en_AU' },
    { property: 'og:url', content: opts.url },
    { property: 'og:title', content: opts.title },
    { property: 'og:description', content: opts.description },
    { property: 'og:image', content: `${siteUrl}/icon-512.png` },
    { name: 'twitter:card', content: 'summary' },
  ]
}

export function stopJsonLd(stopId: string, name: string, url: string, siteUrl = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BusStop',
        '@id': `${url}#stop`,
        name,
        url,
        identifier: stopCode(stopId) ?? stopId,
        containedInPlace: { '@type': 'City', name: 'Brisbane' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name, item: url },
        ],
      },
    ],
  }
}

const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Stop pages per sitemap file (the protocol allows 50k; smaller files are cheaper to build in the Worker). */
export const STOPS_PER_SITEMAP = 5000

/** Stop keys from the raw stops.json text without JSON.parse (cheap enough for the Worker's CPU budget). */
export function stopKeysFromIndexText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\{"key":"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${m[1]}"`) as string)
  return out
}

export function routeShortsFromLinesText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\{"short":"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${m[1]}"`) as string)
  return out
}

export function sitemapIndexXml(siteUrl: string, stopCount: number, nowMs: number): string {
  const today = dateKey.format(nowMs)
  const files = ['/sitemaps/pages.xml', '/sitemaps/routes.xml']
  for (let i = 0; i * STOPS_PER_SITEMAP < stopCount; i++) files.push(`/sitemaps/stops-${i + 1}.xml`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((f) => `  <sitemap><loc>${esc(siteUrl + f)}</loc><lastmod>${today}</lastmod></sitemap>`).join('\n')}
</sitemapindex>
`
}

export function urlsetXml(
  siteUrl: string,
  paths: string[],
  opts: { changefreq: string; priority: string },
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map(
    (p) =>
      `  <url><loc>${esc(siteUrl + p)}</loc><changefreq>${opts.changefreq}</changefreq><priority>${opts.priority}</priority></url>`,
  )
  .join('\n')}
</urlset>
`
}

/** Staging and a production soft launch (INDEXABLE not "1") disallow everything, like train. */
export function robotsTxt(siteUrl: string, indexable: boolean): string {
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /__fixtures/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
}
