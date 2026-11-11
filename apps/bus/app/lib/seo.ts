/**
 * Titles, descriptions, canonicals, OG tags, JSON-LD and the sitemap index for BrisbaneBus. Inside BrisbaneTransit
 * (BASE set) the pages carry its name and its 1200×630 share image, and titles and descriptions are fitted to snippet
 * length; the standalone app's are as they were.
 */
import { BASE } from './base.ts'
import { stopCode, stopPath } from './stops.ts'

export const SITE_URL = 'https://bft-bus.brisbanetransit.workers.dev'
/** The site's name: BrisbaneTransit's on its pages, else the standalone app's. */
export const SITE_NAME = BASE ? 'Brisbane Transit' : 'BrisbaneBus'

/**
 * The first candidate within `max` characters, else the last (shortest). Search engines show about 60 characters of a
 * title and 160 of a description, so a page offers its candidates longest-first and keeps the first that fits. Local to
 * each app on purpose: a shared module became its own chunk on every mode page's first load (+370 B gz on /ferry).
 */
const firstFit = (max: number, ...candidates: string[]) =>
  candidates.find((c) => c.length <= max) ?? candidates[candidates.length - 1] ?? ''
const fitTitle = (...c: string[]) => firstFit(60, ...c)
const fitDescription = (...c: string[]) => firstFit(160, ...c)

export const HOME_META = BASE
  ? {
      title: `Brisbane buses: live departures by stop | ${SITE_NAME}`,
      description:
        'Live departure boards for every Brisbane bus stop and busway platform: search by name or number, find stops near you, and see Metro, CityGlider and BUZ times.',
    }
  : {
      title: 'BrisbaneBus - live Brisbane bus departures by stop',
      description:
        'Live departure boards for every Brisbane bus stop and busway platform: search by stop name or number, find stops near you, and see Metro, CityGlider and BUZ services in real time.',
    }

/** The share image: BrisbaneTransit's 1200×630 card at its root (public/og-image.jpg), or the standalone app's icon. */
export function ogImage(siteUrl: string): { url: string; large: boolean } {
  if (BASE) {
    try {
      return { url: `${new URL(siteUrl).origin}/og-image.jpg`, large: true }
    } catch {}
  }
  return { url: `${siteUrl}/icon-512.png`, large: false }
}

export const ATTRIBUTION = {
  text: 'Based on TransLink data provided by the State of Queensland (Department of Transport and Main Roads)',
  licenceName: 'Creative Commons Attribution 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

const routesText = (routes: string[], n: number) =>
  routes.length ? ` Routes ${routes.slice(0, n).join(', ')}${routes.length > n ? ' and more' : ''}.` : ''

export function stopMetaTags(stopId: string, name: string, routes: string[], siteUrl = SITE_URL) {
  const code = stopCode(stopId)
  const url = `${siteUrl}${stopPath(stopId)}`
  if (!BASE)
    return {
      title: `${name}${code ? ` (stop ${code})` : ''} - next buses, live times | ${SITE_NAME}`,
      description: `Live bus departures from ${name}, Brisbane${code ? `, stop ${code}` : ''}.${routesText(routes, 8)} Real-time TransLink updates every 15 seconds.`,
      url,
    }
  const stop = `${name}${code ? `, stop ${code}` : ''}`
  return {
    // Long stop names drop the stop number, then the site name, before the name itself is cut.
    title: fitTitle(
      `${name}${code ? ` (stop ${code})` : ''}: next buses | ${SITE_NAME}`,
      `${name}: next buses | ${SITE_NAME}`,
      `${name}: next buses`,
      name,
    ),
    description: fitDescription(
      `Live bus departures from ${stop}, Brisbane.${routesText(routes, 8)} Real-time Translink updates.`,
      `Live bus departures from ${stop}, Brisbane.${routesText(routes, 4)} Real-time Translink updates.`,
      `Live bus departures from ${stop}, Brisbane.${routesText(routes, 4)}`,
      `Live bus departures from ${stop}, Brisbane.`,
    ),
    url,
  }
}

export function routeMetaTags(short: string, long: string | undefined, siteUrl = SITE_URL) {
  const url = `${siteUrl}/route/${encodeURIComponent(short)}`
  if (!BASE)
    return {
      title: `Route ${short}${long ? ` ${long}` : ''} - live buses and stops | ${SITE_NAME}`,
      description: `Every stop on Brisbane bus route ${short}${long ? ` (${long})` : ''}, with live bus positions and departures from each stop.`,
      url,
    }
  return {
    title: fitTitle(
      `Bus route ${short}${long ? ` ${long}` : ''} | ${SITE_NAME}`,
      `Bus route ${short}${long ? ` ${long}` : ''}`,
      `Bus route ${short} | ${SITE_NAME}`,
      `Bus route ${short}`,
    ),
    description: fitDescription(
      `Every stop on Brisbane bus route ${short}${long ? ` (${long})` : ''}, with live bus positions and departures from each stop.`,
      `Every stop on Brisbane bus route ${short}, with live bus positions and departures from each stop.`,
    ),
    url,
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
  const image = ogImage(opts.siteUrl ?? SITE_URL)
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
    { property: 'og:image', content: image.url },
    ...(image.large
      ? [
          { property: 'og:image:width', content: '1200' },
          { property: 'og:image:height', content: '630' },
          { property: 'og:image:alt', content: 'Brisbane Transit: live ferry, train and bus departures' },
        ]
      : []),
    { name: 'twitter:card', content: image.large ? 'summary_large_image' : 'summary' },
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
          { '@type': 'ListItem', position: 1, name: BASE ? 'Bus' : SITE_NAME, item: `${siteUrl}/` },
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

/**
 * Each stop's key and name from the raw stops.json text, once each, in file order: only the index's own entries. The
 * old regex over the text also matched each stop's `boardAt` list (other stops as `{"key","name"}` objects), so 97
 * stop URLs were in the sitemap two to four times. JSON.parse of the ~1.6 MB file takes about as long as that regex
 * did (~4 ms). Anything unreadable gives no stops.
 */
export function stopEntriesFromIndexText(text: string): { key: string; name: string }[] {
  let stops: unknown
  try {
    stops = (JSON.parse(text) as { stops?: unknown } | null)?.stops
  } catch {
    return []
  }
  if (!Array.isArray(stops)) return []
  const out: { key: string; name: string }[] = []
  const seen = new Set<string>()
  for (const s of stops as { key?: unknown; name?: unknown }[]) {
    if (typeof s?.key !== 'string' || typeof s.name !== 'string' || seen.has(s.key)) continue
    seen.add(s.key)
    out.push({ key: s.key, name: s.name })
  }
  return out
}

/** Every stop key once, in file order (stopEntriesFromIndexText). */
export const stopKeysFromIndexText = (text: string): string[] =>
  stopEntriesFromIndexText(text).map((e) => e.key)

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
