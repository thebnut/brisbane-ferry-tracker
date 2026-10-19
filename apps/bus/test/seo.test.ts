import { describe, expect, it } from 'vitest'
import { FastStopIndex, validateProxied } from '../app/lib/contract.server.ts'
import { robotsTxt, sitemapIndexXml, stopKeysFromIndexText, stopMetaTags, urlsetXml } from '../app/lib/seo.ts'
import { canonicalStopId, normaliseCode, stopCode, tripPath } from '../app/lib/stops.ts'
import { savedFromCookie, themeFromCookie } from '../app/lib/storage.ts'

describe('seo', () => {
  it('stop meta has the name, stop number and routes', () => {
    const m = stopMetaTags('10802', 'Cultural Centre station, platform 1', ['M1', 'M2', '66'], 'https://x')
    expect(m.title).toBe(
      'Cultural Centre station, platform 1 (stop 010802) - next buses, live times | BrisbaneBus',
    )
    expect(m.description).toContain('Routes M1, M2, 66.')
    expect(m.url).toBe('https://x/stop/10802')
  })
  it('sitemap index splits 12k stops into files of 5,000', () => {
    const xml = sitemapIndexXml('https://x', 12_364, Date.UTC(2026, 9, 18))
    expect(xml.match(/<sitemap>/g)).toHaveLength(5)
    expect(xml).toContain('https://x/sitemaps/stops-3.xml')
    expect(urlsetXml('https://x', ['/stop/1', '/a&b'], { changefreq: 'daily', priority: '0.7' })).toContain(
      '<loc>https://x/a&amp;b</loc>',
    )
    expect(robotsTxt('https://x', true)).toContain('Sitemap: https://x/sitemap.xml')
    expect(robotsTxt('https://x', false)).toBe('User-agent: *\nDisallow: /\n')
  })
  it('reads keys from raw index text without parsing it', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      stops: [
        { key: '10802', name: 'A "q"' },
        { key: 'place_x', name: 'B' },
      ],
    })
    expect(stopKeysFromIndexText(text)).toEqual(['10802', 'place_x'])
  })
})

describe('stops and cookies', () => {
  it('stop codes', () => {
    expect(stopCode('10802')).toBe('010802')
    expect(stopCode('place_ccbs')).toBeNull()
    expect(normaliseCode('000037')).toBe('37')
    // R3-B10: the zero-padded public number maps back to the stop_id; other ids are untouched.
    expect(canonicalStopId('010813')).toBe('10813')
    expect(canonicalStopId(stopCode('2810') ?? '')).toBe('2810')
    expect(canonicalStopId('10813')).toBe('10813')
    expect(canonicalStopId('place_uqlksa')).toBe('place_uqlksa')
    expect(canonicalStopId('0')).toBe('0')
    expect(tripPath('a b@20261018', '10802')).toBe('/trip/a%20b%4020261018?from=10802')
  })
  it('saved-stop and theme cookies are sanitised', () => {
    expect(savedFromCookie('bft_bus_saved=10802.37.<x>.1.2')).toEqual(['10802', '37', '1'])
    expect(savedFromCookie(null)).toEqual([])
    expect(themeFromCookie('bft_theme=dark')).toBe('dark')
    expect(themeFromCookie('bft_theme=evil')).toBe('system')
    // Malformed percent-encoding must not throw (it would 500 every SSR page).
    expect(themeFromCookie('bft_theme=%E0%A4%A')).toBe('system')
    expect(savedFromCookie('bft_bus_saved=%E0%A4%A')).toEqual([])
  })
})

describe('edge contract check', () => {
  it('passes valid /v1 bodies, 502s drifted ones', async () => {
    const bad = await validateProxied('/v1/bus/stops/1/departures', Response.json({ nope: 1 }))
    expect(bad.status).toBe(502)
    const err = await validateProxied(
      '/v1/bus/stops/1/departures',
      Response.json({ error: 'unknown stop' }, { status: 404 }),
    )
    expect(err.status).toBe(404)
  })
  it('checks the stop index shallowly', () => {
    const ok = {
      schemaVersion: 1,
      mode: 'bus',
      generation: 'g',
      stops: [{ key: '1', name: 'A', lat: 1, lon: 2, routes: [] }],
    }
    expect(FastStopIndex.safeParse(ok).success).toBe(true)
    expect(FastStopIndex.safeParse({ ...ok, stops: [{ key: 1 }] }).success).toBe(false)
    // A bad entry anywhere fails, not just in the first few hundred (Codex review).
    const many = Array.from({ length: 500 }, (_, i) => ({
      key: String(i),
      name: 'A',
      lat: 1,
      lon: 2,
      routes: [],
    }))
    many[400] = { ...many[400], code: 5 } as never
    expect(FastStopIndex.safeParse({ ...ok, stops: many }).success).toBe(false)
  })
  it('passes data 404s through (empty geo tiles)', async () => {
    const res = await validateProxied('/data/bus/geo/zzzzz.json', new Response('x', { status: 404 }))
    expect(res.status).toBe(404)
  })
})
