/**
 * P2: route search beside stop search (fixture lines and stops), the route stop picker's directions, order and
 * nearest stop, and the stop page's ?route= filter.
 */
import { buildRouteSearchIndex, searchRoutes } from '@bft/core/route-search'
import { RouterContextProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { departuresPath } from '../app/lib/api.ts'
import { cloudflareContext } from '../app/lib/context.ts'
import type { RouteFile, StopIndexEntry } from '../app/lib/data-contract.ts'
import { directions, nearestStop, stopForRouteHref } from '../app/lib/route-picker.ts'
import { buildSearchIndex, searchStops } from '../app/lib/search.ts'
import { loader as stopLoader } from '../app/routes/stop.tsx'
import fixture from '../fixtures/bus-day.json'

const stops = fixture.stops as StopIndexEntry[]
const stopIndex = buildSearchIndex(stops)
const routeIndex = buildRouteSearchIndex(
  fixture.lines.map((l) => l.short),
  fixture.lines,
)
const routes = (q: string) => searchRoutes(routeIndex, q)

describe('route search beside stop search (fixtures)', () => {
  it('a route number puts that route first and the Routes group above the stops', () => {
    const r = routes('333')
    expect(r.routeLike).toBe(true)
    expect(r.hits[0]).toEqual({ short: '333', long: 'Chermside - Woolloongabba via City' })
    expect(routes('M1').hits.map((h) => h.short)).toEqual(['M1'])
    expect(routes('m2').hits[0]?.long).toBe('RBWH - UQ Lakes via City')
  })

  it('a place name matches long names, below the stops (which still rank first)', () => {
    const r = routes('Chermside')
    expect(r.routeLike).toBe(false)
    expect(r.hits.map((h) => h.short)).toEqual(['333'])
    expect(routes('UQ Lakes').hits.map((h) => h.short)).toEqual(['192', 'M2'])
  })

  it('a stop number is a stop, not a route: no Routes group', () => {
    expect(searchStops(stopIndex, '10802', 5).exact).toBe(true)
    expect(routes('10802').hits).toEqual([])
    expect(routes('010802').hits).toEqual([])
  })
})

const stop = (key: string, lat: number, lon: number) => ({ key, name: `Stop ${key}`, lat, lon })
const routeFile: RouteFile = {
  schemaVersion: 1,
  mode: 'bus',
  generation: 'g',
  short: '333',
  patterns: [
    // The route file lists patterns busiest first; direction 1 happens to come first here.
    {
      directionId: 1,
      headsign: 'Chermside',
      trips: 90,
      stops: [stop('c', -27.4, 153.0), stop('d', -27.3, 153.0)],
    },
    {
      directionId: 0,
      headsign: 'City',
      trips: 100,
      stops: [stop('a', -27.3, 153.0), stop('b', -27.47, 153.02)],
    },
    { directionId: 0, headsign: 'City (short)', trips: 20, stops: [stop('x', -27.3, 153.0)] },
  ],
}

describe('route stop picker', () => {
  it('has one pattern per direction, the busiest, in direction order', () => {
    expect(directions(routeFile).map((p) => [p.directionId, p.headsign])).toEqual([
      [0, 'City'],
      [1, 'Chermside'],
    ])
  })

  it('keeps each direction’s stops in travel order', () => {
    expect(directions(routeFile).map((p) => p.stops.map((s) => s.key))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('finds the nearest stop, and none too far away or for no stops', () => {
    const [city] = directions(routeFile)
    expect(nearestStop(city?.stops ?? [], { lat: -27.469, lon: 153.021 })).toBe(1)
    expect(nearestStop(city?.stops ?? [], { lat: -28.5, lon: 153.0 })).toBe(-1)
    expect(nearestStop([], { lat: -27.4, lon: 153 })).toBe(-1)
  })

  it('links each stop to its board filtered to the route', () => {
    expect(stopForRouteHref('10802', '333')).toBe('/stop/10802?route=333')
    expect(stopForRouteHref('10802', 'M1')).toBe('/stop/10802?route=M1')
  })
})

const loadStop = async (search: string) => {
  const ctx = new RouterContextProvider()
  const env = { FIXTURES: '1', SITE_URL: 'https://bus.test' } as unknown as Env
  ctx.set(cloudflareContext, { env, ctx: {} as ExecutionContext, nonce: 'n' })
  const args = {
    request: new Request(`https://bus.test/stop/10802${search}`),
    context: ctx,
    params: { stopId: '10802' },
  }
  return stopLoader(args as unknown as Parameters<typeof stopLoader>[0])
}

describe('stop page ?route=', () => {
  it('starts the board on a valid route short name', async () => {
    expect((await loadStop('?route=333')).route).toBe('333')
    expect((await loadStop('?route=M1')).route).toBe('M1')
  })

  it('asks the API for that route only, so a busy stop still lists it', async () => {
    // 08:00 AEST on the fixture day, at Cultural Centre platform 1: many routes, and 333 among them.
    const at = `fixtureNow=${Date.UTC(2026, 9, 19, 22)}`
    const all = (await loadStop(`?${at}`)).departures?.departures ?? []
    const only = (await loadStop(`?route=333&${at}`)).departures?.departures ?? []
    expect(new Set(all.map((d) => d.route.short)).size).toBeGreaterThan(1)
    expect(only.length).toBeGreaterThan(0)
    expect(only.every((d) => d.route.short === '333')).toBe(true)
  })

  it('ignores a missing, empty, malformed or unknown value', async () => {
    expect('route' in (await loadStop(''))).toBe(false)
    expect((await loadStop('?route=')).route).toBeUndefined()
    expect((await loadStop('?route=%3Cscript%3E')).route).toBeUndefined()
    expect((await loadStop('?route=a/b')).route).toBeUndefined()
    // Well formed but not a current route (not in data/bus/routes.json): the whole board, not an empty one.
    expect((await loadStop('?route=NO_SUCH')).route).toBeUndefined()
    expect((await loadStop('?route=999')).route).toBeUndefined()
    expect((await loadStop(`?route=${'9'.repeat(13)}`)).route).toBeUndefined()
  })
})

describe('departuresPath', () => {
  it('adds the route filter only when given, encoded', () => {
    expect(departuresPath('10802')).toBe('/v1/bus/stops/10802/departures?limit=20')
    expect(departuresPath('10802', 20, 'M1')).toBe('/v1/bus/stops/10802/departures?limit=20&route=M1')
    expect(departuresPath('10802', 100, 'a b')).toBe('/v1/bus/stops/10802/departures?limit=100&route=a%20b')
  })
})
