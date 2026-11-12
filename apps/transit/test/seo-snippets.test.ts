// @vitest-environment node
/**
 * The mounted mode pages' search snippets inside BrisbaneTransit: titles and descriptions that fit (about 60 and 160
 * characters; Central's description was 366 and a bus stop's title 91), the site's own name in og:site_name and
 * JSON-LD, its 1200×630 share card, and the popular links on the landing page pointing at real places.
 */
import { routeMetaTags, stopMetaTags } from '@bft/bus/app/lib/seo.ts'
import { homeJsonLd as ferryHomeJsonLd, terminalMeta } from '@bft/ferry/app/lib/seo.ts'
import { TERMINALS } from '@bft/ferry/app/lib/terminals.ts'
import { STATIONS, stationByKey } from '@bft/train/app/lib/network.ts'
import { stationMeta, pageMeta as trainPageMeta } from '@bft/train/app/lib/seo.ts'
import { meta as trainMapMeta } from '@bft/train/app/routes/map.tsx'
import { describe, expect, it } from 'vitest'

const TITLE_MAX = 60
const DESCRIPTION_MAX = 160
const TRANSIT_SITE_NAME = 'Brisbane Transit'

import { POPULAR_STATIONS, POPULAR_STOPS, POPULAR_TERMINALS } from '../app/lib/popular.ts'

const SITE = 'https://brisbanetransit.com'

describe('snippet lengths', () => {
  it('every ferry terminal: title ≤ 60, description ≤ 160, the terminal named in both', () => {
    for (const t of TERMINALS) {
      const m = terminalMeta(t, `${SITE}/ferry`)
      expect(m.title.length, m.title).toBeLessThanOrEqual(TITLE_MAX)
      expect(m.description.length, m.description).toBeLessThanOrEqual(DESCRIPTION_MAX)
      expect(m.title).toContain(`${t.name} ferry terminal`)
      expect(m.description).toContain(t.name)
    }
    const southBank = TERMINALS.find((t) => t.slug === 'south-bank')
    if (!southBank) throw new Error('no South Bank terminal')
    expect(terminalMeta(southBank, `${SITE}/ferry`).title).toBe(
      'South Bank ferry terminal: CityCat times | Brisbane Transit',
    )
  })

  it('every train station and a few trips: title ≤ 60, description ≤ 160 (Central was 366)', () => {
    for (const s of STATIONS) {
      const m = stationMeta(s, `${SITE}/train`)
      expect(m.title.length, m.title).toBeLessThanOrEqual(TITLE_MAX)
      expect(m.description.length, m.description).toBeLessThanOrEqual(DESCRIPTION_MAX)
      expect(m.title).toContain(s.name)
    }
    const central = stationByKey('central')
    if (!central) throw new Error('no Central station')
    expect(stationMeta(central, `${SITE}/train`).description).toMatch(/Lines: .+ and \d+ more\./)
    const pair = stationMeta(central, `${SITE}/train`, stationByKey('springfield-central'))
    expect(pair.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(pair.url).toBe(`${SITE}/train/station/central`)
  })

  it('bus stops: a long name keeps the name and drops the trimmings (stop 1 was 91 characters)', () => {
    const long = stopMetaTags(
      '1',
      'Herschel Street Stop 1 near North Quay',
      ['470', '475', '476'],
      `${SITE}/bus`,
    )
    expect(long.title.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(long.title.startsWith('Herschel Street Stop 1 near North Quay')).toBe(true)
    expect(long.description).toContain('stop 000001')
    const short = stopMetaTags('10000', 'Balcara Ave near Allira Cr', ['335'], `${SITE}/bus`)
    expect(short.title).toBe('Balcara Ave near Allira Cr: next buses | Brisbane Transit')
    const many = stopMetaTags(
      '10',
      'Ann Street Stop 11 at King George Square',
      Array.from({ length: 16 }, (_, i) => String(400 + i)),
      `${SITE}/bus`,
    )
    expect(many.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(many.description).toContain('and more')
  })
})

describe('bus routes', () => {
  it('a title that fits keeps the most; the last fallback is the shortest (Codex r3)', () => {
    expect(routeMetaTags('66', 'RBWH to UQ Lakes', `${SITE}/bus`).title).toBe(
      'Bus route 66 RBWH to UQ Lakes | Brisbane Transit',
    )
    expect(routeMetaTags('199', undefined, `${SITE}/bus`).title).toBe('Bus route 199 | Brisbane Transit')
    const long = routeMetaTags('X'.repeat(51), undefined, `${SITE}/bus`).title
    expect(long).toBe(`Bus route ${'X'.repeat(51)}`)
  })
})

describe('the site name on mounted pages', () => {
  it('og:site_name and JSON-LD say Brisbane Transit, and the WebSite is the landing page', () => {
    const tags = trainPageMeta({
      title: 't',
      description: 'd',
      url: `${SITE}/train/`,
      site: { siteUrl: `${SITE}/train`, indexable: true },
    }) as Record<string, string>[]
    expect(tags.find((t) => t.property === 'og:site_name')?.content).toBe(TRANSIT_SITE_NAME)
    expect(tags.find((t) => t.property === 'og:image')?.content).toBe(`${SITE}/og-image.jpg`)
    expect(tags.find((t) => t.name === 'twitter:card')?.content).toBe('summary_large_image')
    const ld = JSON.stringify(ferryHomeJsonLd(`${SITE}/ferry`))
    expect(ld).toContain(`"@id":"${SITE}/#website"`)
    expect(ld).toContain(`"name":"${TRANSIT_SITE_NAME}"`)
    // The old name stays as an alternate, so old searches still match.
    expect(ld).toContain('Brisbane Ferry Tracker')
  })

  it('a page that is noindex itself has no canonical (train map), as on ferry and bus', () => {
    const tags = trainMapMeta({
      loaderData: { site: { siteUrl: `${SITE}/train`, indexable: true } },
    } as never) as Record<string, string>[] | undefined
    expect(tags?.find((t) => t.name === 'robots')?.content).toBe('noindex')
    expect(tags?.find((t) => t.rel === 'canonical')).toBeUndefined()
  })

  it('a site not yet indexable (preview) keeps canonicals: they name the production URLs', () => {
    const tags = trainPageMeta({
      title: 't',
      description: 'd',
      url: `${SITE}/train/stations`,
      site: { siteUrl: `${SITE}/train`, indexable: false },
    }) as Record<string, string>[]
    expect(tags.find((t) => t.name === 'robots')?.content).toBe('noindex')
    expect(tags.find((t) => t.rel === 'canonical')?.href).toBe(`${SITE}/train/stations`)
  })
})

describe('popular places on the landing page', () => {
  it('every one is a real terminal, station or stop', () => {
    for (const [slug, name] of POPULAR_TERMINALS)
      expect(TERMINALS.find((t) => t.slug === slug)?.name, slug).toBe(name)
    for (const [key, name] of POPULAR_STATIONS) expect(stationByKey(key)?.name, key).toBe(name)
    for (const [id] of POPULAR_STOPS) expect(id).toMatch(/^\d+$/)
  })
})
