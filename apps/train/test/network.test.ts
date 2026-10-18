import { describe, expect, it } from 'vitest'
import { lineNameFor } from '../app/lib/lineNames.ts'
import {
  corridorFor,
  isReachable,
  LINES,
  platformOf,
  reachableFrom,
  STATIONS,
  stationByKey,
  stripFor,
} from '../app/lib/network.ts'

const groupOf = (origin: string, key: string) =>
  reachableFrom(origin)
    .filter((g) => g.stations.some((s) => s.key === key))
    .map((g) => g.line.name)

describe('network data', () => {
  it('has all 154 stations, each with at least one platform', () => {
    expect(STATIONS).toHaveLength(154)
    for (const s of STATIONS) expect(s.platforms.length).toBeGreaterThan(0)
  })
  it('golden Central is multi-platform and platform ids map back to it', () => {
    const central = stationByKey('central')
    expect(central?.platforms.map((p) => p.code)).toEqual(['1', '2', '3', '4', '5', '6'])
    for (const p of central?.platforms ?? []) expect(platformOf(p.id)?.station.key).toBe('central')
  })
  it('names lines from headsign or the outer end of the route', () => {
    expect(lineNameFor('Brisbane City - Springfield', 'Springfield Central station')).toBe('Springfield')
    expect(lineNameFor('Springfield - Brisbane City', 'Roma Street station')).toBe('Springfield')
    expect(lineNameFor('Brisbane City - Caboolture', 'Northgate station')).toBe('Caboolture')
    expect(lineNameFor('Ipswich - Rosewood', 'Rosewood station')).toBe('Ipswich/Rosewood')
    expect(lineNameFor('Airport - Varsity Lakes', 'Varsity Lakes station')).toBe('Gold Coast')
    expect(lineNameFor('Brisbane City - Brisbane City', 'Bowen Hills station')).toBe('City')
  })
  it('every line has a colour and at least one pattern', () => {
    for (const l of LINES) {
      expect(l.color).toMatch(/^[0-9A-F]{6}$/)
      expect(l.patterns.length).toBeGreaterThan(0)
    }
  })
})

describe('reachable-only picker (golden Bowen Hills, branching)', () => {
  const groups = reachableFrom('bowen-hills')
  it('groups by line and direction, never offers the origin', () => {
    expect(groups.length).toBeGreaterThan(5)
    for (const g of groups) expect(g.stations.some((s) => s.key === 'bowen-hills')).toBe(false)
  })
  it('branch stations appear only under the lines that serve them', () => {
    expect(groupOf('bowen-hills', 'ferny-grove')).toEqual(['Ferny Grove'])
    expect(groupOf('bowen-hills', 'doomben')).toEqual(['Doomben'])
    expect(groupOf('bowen-hills', 'domestic-airport')).toEqual(['Airport'])
    expect(groupOf('bowen-hills', 'kippa-ring')).toEqual(['Redcliffe Peninsula'])
  })
  it('stations are listed in travel order along the line', () => {
    const fg = groups.find(
      (g) => g.line.name === 'Ferny Grove' && g.stations.some((s) => s.key === 'ferny-grove'),
    )
    const keys = fg?.stations.map((s) => s.key) ?? []
    expect(keys.indexOf('windsor')).toBeLessThan(keys.indexOf('mitchelton'))
    expect(keys.indexOf('mitchelton')).toBeLessThan(keys.indexOf('ferny-grove'))
  })
  it('branch to branch is not a direct trip, and the picker agrees with isReachable', () => {
    expect(isReachable('ferny-grove', 'doomben')).toBe(false)
    expect(isReachable('doomben', 'domestic-airport')).toBe(false)
    expect(isReachable('domestic-airport', 'varsity-lakes')).toBe(true)
    for (const g of groups) for (const s of g.stations) expect(isReachable('bowen-hills', s.key)).toBe(true)
  })
})

describe('stopping-pattern strip', () => {
  it('an express shows the stations it runs through as hollow dots', () => {
    // Roma Street → Ferny Grove expresses skip inner stations compared with the all-stops pattern.
    const allStops = corridorFor(['roma-street', 'ferny-grove'])
    expect(allStops.length).toBeGreaterThan(10)
    const calls = allStops.filter((_, i) => i % 2 === 0 || i === allStops.length - 1).slice(1)
    const strip = stripFor({
      from: 'roma-street',
      stopsAfter: calls,
      route: 'BRFG',
      headsign: 'Ferny Grove',
      maxDots: 99,
    })
    expect(strip.map((s) => s.id)).toEqual(allStops)
    for (const s of strip) expect(s.stops).toBe(s.id === 'roma-street' || calls.includes(s.id))
    expect(strip.some((s) => !s.stops)).toBe(true)
  })
  it('ends at the chosen destination and shortens long runs with a gap', () => {
    const calls = corridorFor(['roma-street', 'ferny-grove']).slice(1)
    const toMitchelton = stripFor({
      from: 'roma-street',
      stopsAfter: calls,
      route: 'BRFG',
      headsign: 'Ferny Grove',
      to: 'mitchelton',
    })
    expect(toMitchelton.at(-1)?.id).toBe('mitchelton')
    const long = stripFor({
      from: 'roma-street',
      stopsAfter: calls,
      route: 'BRFG',
      headsign: 'Ferny Grove',
      maxDots: 6,
    })
    expect(long).toHaveLength(6)
    expect(long.at(-1)).toMatchObject({ id: 'ferny-grove', gapBefore: true })
  })
  it('without stopsAfter it falls back to the busiest pattern for the route', () => {
    const strip = stripFor({ from: 'roma-street', stopsAfter: null, route: 'BRFG', headsign: 'Ferny Grove' })
    expect(strip[0]?.id).toBe('roma-street')
    expect(strip.length).toBeGreaterThan(2)
  })
})
