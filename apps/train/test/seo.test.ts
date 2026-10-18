import { describe, expect, it } from 'vitest'
import { STATIONS, stationByKey } from '../app/lib/network.ts'
import { pageMeta, robotsTxt, sitemapXml, stationMeta } from '../app/lib/seo.ts'

const SITE = 'https://bft-train.brisbanetransit.workers.dev'

describe('SEO', () => {
  it('sitemap lists home, stations, alerts and every station page', () => {
    const xml = sitemapXml(SITE, Date.UTC(2026, 9, 18))
    expect(xml.match(/<url>/g)).toHaveLength(STATIONS.length + 3)
    expect(xml).toContain(`${SITE}/station/bowen-hills</loc>`)
  })
  it('staging is never indexed', () => {
    expect(robotsTxt(SITE, false)).toBe('User-agent: *\nDisallow: /\n')
    expect(robotsTxt(SITE, true)).toContain('Sitemap:')
    const tags = pageMeta({
      title: 't',
      description: 'd',
      url: SITE,
      site: { siteUrl: SITE, indexable: false },
    })
    expect(tags).toContainEqual({ name: 'robots', content: 'noindex' })
  })
  it('station titles and pair pages canonicalise to the station', () => {
    const c = stationByKey('central')
    const t = stationByKey('indooroopilly')
    if (!c || !t) throw new Error('missing')
    expect(stationMeta(c, SITE).title).toBe(
      'Next train from Central station – live departures | BrisbaneTrain',
    )
    expect(stationMeta(c, SITE, t).url).toBe(`${SITE}/station/central`)
  })
})
