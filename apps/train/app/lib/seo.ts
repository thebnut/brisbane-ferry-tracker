/**
 * Titles, descriptions, canonicals, OG tags, JSON-LD and the sitemap for BrisbaneTrain. SITE_URL comes from the
 * Worker's vars (staging: the workers.dev host). Pages are `noindex` and robots.txt disallows everything unless
 * INDEXABLE is "1", so staging never competes with the eventual brisbanetrain.com in search results.
 */
import { BASE } from './base.ts'
import { lineLabel } from './lineNames.ts'
import { linesBetween, reachableFrom, STATIONS, type Station, stationPath } from './network.ts'

export const SITE_URL = 'https://bft-train.brisbanetransit.workers.dev'
/**
 * The site's name: BrisbaneTransit's on its pages (BASE set: og:site_name, JSON-LD, its share image, titles and
 * descriptions fitted to snippet length), else the standalone app's.
 */
export const BRAND = BASE ? 'Brisbane Transit' : 'BrisbaneTrain'

/**
 * The first candidate within `max` characters, else the last (shortest). Search engines show about 60 characters of a
 * title and 160 of a description, so a page offers its candidates longest-first and keeps the first that fits. Local to
 * each app on purpose: a shared module became its own chunk on every mode page's first load (+370 B gz on /ferry).
 */
const firstFit = (max: number, ...candidates: string[]) =>
  candidates.find((c) => c.length <= max) ?? candidates[candidates.length - 1] ?? ''
const fitTitle = (...c: string[]) => firstFit(60, ...c)
const fitDescription = (...c: string[]) => firstFit(160, ...c)

export const ATTRIBUTION = {
  text: 'Based on TransLink data provided by the State of Queensland (Department of Transport and Main Roads)',
  licenceName: 'Creative Commons Attribution 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

export interface SiteInfo {
  siteUrl: string
  indexable: boolean
}

export const HOME_META = BASE
  ? {
      title: `Brisbane trains: live departures | ${BRAND}`,
      description:
        'Live departure boards for every Queensland Rail station in South East Queensland: next trains, platforms, platform changes and line status.',
    }
  : {
      title: 'BrisbaneTrain – live Brisbane train departures and platforms',
      description:
        'Live departure boards for every Queensland Rail station in South East Queensland: next trains, platforms and platform changes, stopping patterns and line status.',
    }

/** BrisbaneTransit's own origin, from the train pages' site URL (`…/train`). */
function transitOrigin(siteUrl: string): string {
  try {
    return new URL(siteUrl).origin
  } catch {
    return siteUrl
  }
}

/** Lines serving a station, by display name. */
export function stationLines(station: Station): string[] {
  return [...new Set(reachableFrom(station.key).map((g) => g.line.name))].sort()
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** At most `n` names, then "and N more" ("A, B and 3 more"). */
const some = (items: string[], n: number) =>
  items.length <= n ? list(items) : `${items.slice(0, n).join(', ')} and ${items.length - n} more`

export function stationMeta(station: Station, siteUrl: string, to: Station | null = null) {
  // Pair pages canonicalise to the station page, so 154 × reachable pairs don't compete in search.
  const url = `${siteUrl}${stationPath(station.key)}`
  if (to) {
    const lines = linesBetween(station.key, to.key).map((l) => l.name)
    const on = (n: number) =>
      lines.length ? ` on the ${some(lines, n)} ${lines.length > 1 ? 'lines' : 'line'}` : ''
    if (!BASE)
      return {
        title: `${station.name} to ${to.name} trains – live times and platforms | ${BRAND}`,
        description: `Next trains from ${station.name} to ${to.name}: live departures, platforms and platform changes${on(lines.length)}.`,
        url,
      }
    return {
      title: fitTitle(
        `${station.name} to ${to.name} trains: live times | ${BRAND}`,
        `${station.name} to ${to.name} trains | ${BRAND}`,
        `${station.name} to ${to.name} trains`,
      ),
      description: fitDescription(
        `Next trains from ${station.name} to ${to.name}: live departures, platforms and platform changes${on(lines.length)}.`,
        `Next trains from ${station.name} to ${to.name}: live departures, platforms and platform changes${on(2)}.`,
        `Next trains from ${station.name} to ${to.name}: live departures, platforms and platform changes.`,
      ),
      url,
    }
  }
  const lines = stationLines(station).map(lineLabel)
  const linesText = (n: number) =>
    lines.length ? ` ${lines.length > 1 ? 'Lines' : 'Line'}: ${some(lines, n)}.` : ''
  if (!BASE)
    return {
      title: `Next train from ${station.name} station – live departures | ${BRAND}`,
      description: `Live train departures and platforms for ${station.name} station, Brisbane.${linesText(lines.length)} Real-time updates, platform changes and stopping patterns.`,
      url,
    }
  // A big station (Central: 13 lines, 366 characters before) names its first lines and how many more.
  return {
    title: fitTitle(
      `${station.name} station: live train times | ${BRAND}`,
      `${station.name} station | ${BRAND}`,
      `${station.name} station`,
    ),
    description: fitDescription(
      `Live train departures and platforms for ${station.name} station, Brisbane.${linesText(lines.length)} Real-time updates and platform changes.`,
      `Live train departures and platforms for ${station.name} station, Brisbane.${linesText(2)} Real-time updates and platform changes.`,
      `Live train departures and platforms for ${station.name} station, Brisbane.${linesText(1)}`,
      `Live train departures and platforms for ${station.name} station, Brisbane.`,
    ),
    url,
  }
}

/** The WebSite node the pages belong to: BrisbaneTransit's (its home's @id) on its pages, else this app's own. */
const websiteId = (siteUrl: string) => (BASE ? `${transitOrigin(siteUrl)}/#website` : `${siteUrl}/#website`)

export function homeJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': websiteId(siteUrl),
        url: `${BASE ? transitOrigin(siteUrl) : siteUrl}/`,
        name: BRAND,
        alternateName: BASE ? ['BrisbaneTransit'] : ['BrisbaneTrain Departure Boards'],
        inLanguage: 'en-AU',
      },
      {
        '@type': 'WebApplication',
        '@id': `${siteUrl}/#app`,
        url: `${siteUrl}/`,
        name: BASE ? 'Brisbane train departure boards' : 'BrisbaneTrain Departure Boards',
        description: HOME_META.description,
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'AUD' },
        isPartOf: { '@id': websiteId(siteUrl) },
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
        isPartOf: { '@id': websiteId(siteUrl) },
        inLanguage: 'en-AU',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BASE ? 'Train' : BRAND, item: `${siteUrl}/` },
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

/**
 * Head tags shared by every page: canonical (or noindex), OG and Twitter cards. A page that is noindex itself (the map)
 * has no canonical, as on the ferry and bus pages: a canonical asks for the page to be indexed. A whole site that isn't
 * indexable yet (staging, a soft launch) keeps its canonicals, so they already name the production URLs.
 */
export function pageMeta(opts: {
  title: string
  description: string
  url: string
  site: SiteInfo
  noindex?: boolean
}) {
  const noindex = opts.noindex || !opts.site.indexable
  const image = BASE
    ? { url: `${transitOrigin(opts.site.siteUrl)}/og-image.jpg`, large: true }
    : { url: `${opts.site.siteUrl}/icon-512.png`, large: false }
  return [
    { title: opts.title },
    { name: 'description', content: opts.description },
    ...(opts.noindex ? [] : [{ tagName: 'link', rel: 'canonical', href: opts.url }]),
    ...(noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: BRAND },
    { property: 'og:locale', content: 'en_AU' },
    { property: 'og:url', content: opts.url },
    { property: 'og:title', content: opts.title },
    { property: 'og:description', content: opts.description },
    { property: 'og:image', content: image.url },
    ...(image.large
      ? [
          { property: 'og:image:width', content: '1200' },
          { property: 'og:image:height', content: '630' },
          { property: 'og:image:alt', content: 'Brisbane Transit: live ferry, train and bus departures' },
        ]
      : []),
    { name: 'twitter:card', content: image.large ? 'summary_large_image' : 'summary' },
    { name: 'twitter:title', content: opts.title },
    { name: 'twitter:description', content: opts.description },
  ]
}

const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })

/**
 * Home, the station index, line status and every station page (154). `lastmod` replaces today's date: BrisbaneTransit
 * passes null, for no `<lastmod>`, as it has no real change time.
 */
export function sitemapXml(siteUrl: string, nowMs: number, lastmod?: string | null): string {
  const today = lastmod === undefined ? dateKey.format(nowMs) : lastmod
  const urls = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    { loc: '/stations', changefreq: 'weekly', priority: '0.6' },
    ...[...STATIONS]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ loc: stationPath(s.key), changefreq: 'daily', priority: '0.8' })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, changefreq, priority }) =>
      `  <url>\n    <loc>${siteUrl}${loc}</loc>\n${today ? `    <lastmod>${today}</lastmod>\n` : ''}    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
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
