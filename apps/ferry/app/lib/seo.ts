/**
 * SEO content ported from the legacy app (src/utils/terminalPage.js, src/utils/seoContent.js, scripts/postbuild.mjs,
 * index.html). Titles, descriptions, canonicals, OG tags, JSON-LD and sitemap URLs are kept identical.
 */
import ROUTE_STOPS from '../data/routes.json'
import { TERMINALS, type Terminal, terminalById, terminalPath } from './terminals.ts'

export const SITE_URL = 'https://www.brisbaneferry.com'

export const HOME_META = {
  title: 'Brisbane Ferry Tracker - Live CityCat Departures',
  description:
    "Real-time ferry departure times for Brisbane's CityCat and CityHopper services. The quickest way to get live City Cat info!",
  ogDescription:
    "Live departure boards for every Brisbane ferry terminal: next CityCat and ferry times, real-time updates and today's timetable.",
}

export const INTRO_HEADING = 'Brisbane ferry times: live CityCat departures'
export const INTRO_TEXT =
  'Live departure boards for every Brisbane River ferry terminal. Pick any two terminals to see the next CityCat, ' +
  'express CityCat and cross-river ferry services in both directions, with real-time updates from TransLink and the ' +
  'full timetable for the next 24 hours.'

export const ATTRIBUTION = {
  text: 'Based on TransLink data provided by the State of Queensland (Department of Transport and Main Roads)',
  licenceName: 'Creative Commons Attribution 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

export const routeLabel = (code: string) => {
  if (code === 'F1') return 'CityCat (all stops)'
  if (code === 'F11') return 'CityCat express'
  if (/^F1\d$/.test(code)) return 'CityCat'
  if (/^F2\d$/.test(code)) return 'Cross-river ferry'
  return 'Ferry'
}

export interface TerminalRoute {
  code: string
  label: string
  stops: string[]
}

export function terminalRoutes(terminal: Terminal): TerminalRoute[] {
  const stops = ROUTE_STOPS as Record<string, string[]>
  return terminal.routes.map((code) => ({
    code,
    label: routeLabel(code),
    stops: (stops[code] ?? [])
      .map((id) => terminalById(id)?.name)
      .filter((n): n is string => !!n)
      .sort(),
  }))
}

const routeList = (codes: string[]) =>
  codes.length <= 1 ? codes.join('') : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`

export function terminalMeta(terminal: Terminal, siteUrl = SITE_URL) {
  const codes = terminal.routes
  const routes = codes.length ? ` ${codes.length > 1 ? 'Routes' : 'Route'} ${routeList(codes)}.` : ''
  return {
    title: `Next ferry from ${terminal.name} - live CityCat times | Brisbane Ferry`,
    description: `Live ferry departures and today's timetable for ${terminal.name} ferry terminal, Brisbane.${routes} Real-time CityCat updates and nearby terminals.`,
    url: `${siteUrl}${terminalPath(terminal.slug)}`,
  }
}

export function homeJsonLd(siteUrl = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'Brisbane Ferry',
        alternateName: ['BrisbaneFerry Departure Boards', 'Brisbane Ferry Tracker'],
        inLanguage: 'en-AU',
      },
      {
        '@type': 'WebApplication',
        '@id': `${siteUrl}/#app`,
        url: `${siteUrl}/`,
        name: 'Brisbane Ferry Tracker',
        description:
          'Real-time departure boards for Brisbane CityCat and ferry services between any two terminals, with live vessel positions and the daily timetable.',
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'AUD' },
        image: `${siteUrl}/og-image.jpg`,
        isPartOf: { '@id': `${siteUrl}/#website` },
        areaServed: { '@type': 'City', name: 'Brisbane' },
      },
    ],
  }
}

export function terminalJsonLd(
  terminal: Terminal,
  meta: { url: string; title: string; description: string },
  siteUrl = SITE_URL,
) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BoatTerminal',
        '@id': `${meta.url}#terminal`,
        name: `${terminal.name} ferry terminal`,
        url: meta.url,
        geo: { '@type': 'GeoCoordinates', latitude: terminal.lat, longitude: terminal.lng },
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Brisbane',
          addressRegion: 'QLD',
          addressCountry: 'AU',
        },
        containedInPlace: { '@type': 'City', name: 'Brisbane' },
      },
      {
        '@type': 'WebPage',
        '@id': meta.url,
        url: meta.url,
        name: meta.title,
        description: meta.description,
        about: { '@id': `${meta.url}#terminal` },
        isPartOf: { '@id': `${siteUrl}/#website` },
        inLanguage: 'en-AU',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Brisbane Ferry', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: `${terminal.name} ferry terminal`, item: meta.url },
        ],
      },
    ],
  }
}

/** Head tags shared by every page: canonical/noindex, OG and Twitter cards (index.html + postbuild renderPage). */
export function pageMeta(opts: {
  title: string
  description: string
  url: string
  noindex?: boolean
  ogDescription?: string
  siteUrl?: string
}) {
  const siteUrl = opts.siteUrl ?? SITE_URL
  const og = opts.ogDescription ?? opts.description
  return [
    { title: opts.title },
    { name: 'description', content: opts.description },
    opts.noindex
      ? { name: 'robots', content: 'noindex' }
      : { tagName: 'link', rel: 'canonical', href: opts.url },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Brisbane Ferry' },
    { property: 'og:locale', content: 'en_AU' },
    { property: 'og:url', content: opts.url },
    { property: 'og:title', content: opts.title },
    { property: 'og:description', content: og },
    { property: 'og:image', content: `${siteUrl}/og-image.jpg` },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    {
      property: 'og:image:alt',
      content: 'BrisbaneFerry Departure Boards logo: live CityCat and ferry departures',
    },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: opts.title },
    { name: 'twitter:description', content: og },
    { name: 'twitter:image', content: `${siteUrl}/og-image.jpg` },
  ]
}

const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })

/** Same URL set, order and priorities as the legacy scripts/postbuild.mjs sitemap. */
export function sitemapXml(siteUrl: string, nowMs: number): string {
  const today = dateKey.format(nowMs)
  const urls: Array<{ loc: string; lastmod?: string; changefreq: string; priority: string }> = [
    { loc: '/', lastmod: today, changefreq: 'daily', priority: '1.0' },
    ...TERMINALS.map((t) => ({
      loc: terminalPath(t.slug),
      lastmod: today,
      changefreq: 'daily',
      priority: '0.8',
    })),
    { loc: '/privacy', changefreq: 'yearly', priority: '0.2' },
    { loc: '/terms', changefreq: 'yearly', priority: '0.2' },
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(({ loc, lastmod, changefreq, priority }) =>
    [
      '  <url>',
      `    <loc>${siteUrl}${loc}</loc>`,
      lastmod && `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n'),
  )
  .join('\n')}
</urlset>
`
}
