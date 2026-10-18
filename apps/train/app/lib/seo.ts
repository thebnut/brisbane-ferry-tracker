/**
 * Titles, descriptions, canonicals, OG tags, JSON-LD and the sitemap for BrisbaneTrain. SITE_URL comes from the
 * Worker's vars (staging: the workers.dev host). Pages are `noindex` and robots.txt disallows everything unless
 * INDEXABLE is "1", so staging never competes with the eventual brisbanetrain.com in search results.
 */
import { lineLabel } from './lineNames.ts'
import { linesBetween, reachableFrom, STATIONS, type Station, stationPath } from './network.ts'

export const SITE_URL = 'https://bft-train.brisbanetransit.workers.dev'
export const BRAND = 'BrisbaneTrain'

export const ATTRIBUTION = {
  text: 'Based on TransLink data provided by the State of Queensland (Department of Transport and Main Roads)',
  licenceName: 'Creative Commons Attribution 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

export interface SiteInfo {
  siteUrl: string
  indexable: boolean
}

export const HOME_META = {
  title: 'BrisbaneTrain – live Brisbane train departures and platforms',
  description:
    'Live departure boards for every Queensland Rail station in South East Queensland: next trains, platforms and platform changes, stopping patterns and line status.',
}

/** Lines serving a station, by display name. */
export function stationLines(station: Station): string[] {
  return [...new Set(reachableFrom(station.key).map((g) => g.line.name))].sort()
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

export function stationMeta(station: Station, siteUrl: string, to: Station | null = null) {
  if (to) {
    const lines = linesBetween(station.key, to.key).map((l) => l.name)
    return {
      title: `${station.name} to ${to.name} trains – live times and platforms | ${BRAND}`,
      description: `Next trains from ${station.name} to ${to.name}: live departures, platforms and platform changes${lines.length ? ` on the ${list(lines)} ${lines.length > 1 ? 'lines' : 'line'}` : ''}.`,
      // Pair pages canonicalise to the station page, so 154 × reachable pairs don't compete in search.
      url: `${siteUrl}${stationPath(station.key)}`,
    }
  }
  const lines = stationLines(station)
  return {
    title: `Next train from ${station.name} station – live departures | ${BRAND}`,
    description: `Live train departures and platforms for ${station.name} station, Brisbane.${lines.length ? ` ${lines.length > 1 ? 'Lines' : 'Line'}: ${list(lines.map(lineLabel))}.` : ''} Real-time updates, platform changes and stopping patterns.`,
    url: `${siteUrl}${stationPath(station.key)}`,
  }
}

export function homeJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: BRAND,
        alternateName: ['BrisbaneTrain Departure Boards'],
        inLanguage: 'en-AU',
      },
      {
        '@type': 'WebApplication',
        '@id': `${siteUrl}/#app`,
        url: `${siteUrl}/`,
        name: 'BrisbaneTrain Departure Boards',
        description: HOME_META.description,
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'AUD' },
        isPartOf: { '@id': `${siteUrl}/#website` },
        areaServed: { '@type': 'City', name: 'Brisbane' },
      },
    ],
  }
}

export function stationJsonLd(
  station: Station,
  meta: { url: string; title: string; description: string },
  siteUrl: string,
) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TrainStation',
        '@id': `${siteUrl}${stationPath(station.key)}#station`,
        name: `${station.name} station`,
        url: `${siteUrl}${stationPath(station.key)}`,
        geo: { '@type': 'GeoCoordinates', latitude: station.lat, longitude: station.lon },
        address: { '@type': 'PostalAddress', addressRegion: 'QLD', addressCountry: 'AU' },
      },
      {
        '@type': 'WebPage',
        '@id': meta.url,
        url: meta.url,
        name: meta.title,
        description: meta.description,
        about: { '@id': `${siteUrl}${stationPath(station.key)}#station` },
        isPartOf: { '@id': `${siteUrl}/#website` },
        inLanguage: 'en-AU',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND, item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: 'Stations', item: `${siteUrl}/stations` },
          {
            '@type': 'ListItem',
            position: 3,
            name: `${station.name} station`,
            item: `${siteUrl}${stationPath(station.key)}`,
          },
        ],
      },
    ],
  }
}

/** Head tags shared by every page: canonical (or noindex), OG and Twitter cards. */
export function pageMeta(opts: {
  title: string
  description: string
  url: string
  site: SiteInfo
  noindex?: boolean
}) {
  const noindex = opts.noindex || !opts.site.indexable
  return [
    { title: opts.title },
    { name: 'description', content: opts.description },
    { tagName: 'link', rel: 'canonical', href: opts.url },
    ...(noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: BRAND },
    { property: 'og:locale', content: 'en_AU' },
    { property: 'og:url', content: opts.url },
    { property: 'og:title', content: opts.title },
    { property: 'og:description', content: opts.description },
    { property: 'og:image', content: `${opts.site.siteUrl}/icon-512.png` },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: opts.title },
    { name: 'twitter:description', content: opts.description },
  ]
}

const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })

/** Home, the station index, line status and every station page (154). */
export function sitemapXml(siteUrl: string, nowMs: number): string {
  const today = dateKey.format(nowMs)
  const urls = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    { loc: '/stations', changefreq: 'weekly', priority: '0.6' },
    { loc: '/alerts', changefreq: 'hourly', priority: '0.5' },
    ...[...STATIONS]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ loc: stationPath(s.key), changefreq: 'daily', priority: '0.8' })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, changefreq, priority }) =>
      `  <url>\n    <loc>${siteUrl}${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
  )
  .join('\n')}
</urlset>
`
}

export function robotsTxt(siteUrl: string, indexable: boolean): string {
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /__fixtures/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
}
