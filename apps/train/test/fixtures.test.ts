/** Fixture API: contract-valid responses and the golden stations (Central, Bowen Hills, Domestic Airport). */
import {
  AlertsResponse,
  DeparturesResponse,
  gtfsToEpoch,
  StaticStopDay,
  TripResponse,
  VehiclesResponse,
} from '@bft/core'
import { describe, expect, it } from 'vitest'
import { handleFixtureApi, stationDay } from '../app/lib/fixtures.server.ts'
import { platformOf, stationByKey } from '../app/lib/network.ts'
import fixture from '../fixtures/train-day.json'

// Tuesday 20 Oct 2026, 08:00 Brisbane.
const AM8 = gtfsToEpoch('20261020', 8 * 3600) * 1000
const get = async (path: string, nowMs = AM8) => {
  const res = await handleFixtureApi(new URL(`http://x/__fixtures${path}`), nowMs)
  return { status: res.status, body: (await res.json()) as unknown }
}
const deps = async (path: string, nowMs = AM8) => DeparturesResponse.parse((await get(path, nowMs)).body)

describe('fixture API contract', () => {
  it('departures, trips, vehicles and alerts parse with the core schemas', async () => {
    const d = await deps('/v1/train/stops/central/departures?limit=20')
    expect(d.departures).toHaveLength(20)
    const trip = TripResponse.parse(
      (await get(`/v1/train/trips/${encodeURIComponent(d.departures[0]?.tripInstance ?? '')}`)).body,
    )
    expect(trip.stops.length).toBeGreaterThan(1)
    expect(VehiclesResponse.parse((await get('/v1/train/vehicles')).body).vehicles.length).toBeGreaterThan(10)
    expect(AlertsResponse.parse((await get('/v1/alerts?mode=train')).body).alerts.length).toBe(3)
  })
  it('stop-day files built from the trip index satisfy StaticStopDay', () => {
    const day = stationDay(fixture as never, 'bowen-hills')
    expect(StaticStopDay.safeParse(day).success).toBe(true)
    expect(day?.stops.every((s) => !s.platform || s.key)).toBe(true)
  })
  it('unknown stations and trips are 404s', async () => {
    expect((await get('/v1/train/stops/atlantis/departures')).status).toBe(404)
    expect((await get('/v1/train/trips/nope%4020261020')).status).toBe(404)
  })
  it('rtState can be forced for the banners', async () => {
    const d = await deps('/v1/train/stops/central/departures?rt=unavailable')
    expect(d.rtState).toBe('unavailable')
    expect(d.departures.every((x) => x.status === 'scheduled')).toBe(true)
  })
})

describe('golden: Central (multi-platform) and platform changes', () => {
  it('departures use several platforms, all of them Central’s', async () => {
    const d = await deps('/v1/train/stops/central/departures?limit=60')
    const codes = new Set(d.departures.map((x) => x.platform))
    expect(codes.size).toBeGreaterThanOrEqual(4)
    for (const x of d.departures) expect(platformOf(x.stopId)?.station.key).toBe('central')
  })
  it('a platform change moves the row to another platform of the same station', async () => {
    let changed = 0
    for (const key of ['central', 'roma-street', 'bowen-hills', 'fortitude-valley']) {
      const d = await deps(`/v1/train/stops/${key}/departures?limit=60`)
      for (const x of d.departures.filter((r) => r.scheduledPlatform)) {
        changed++
        expect(x.status).toBe('live')
        expect(x.platform).not.toBe(x.scheduledPlatform)
        expect(platformOf(x.stopId)?.station.key).toBe(key)
        expect(stationByKey(key)?.platforms.map((p) => p.code)).toContain(x.scheduledPlatform)
      }
    }
    expect(changed).toBeGreaterThan(0)
  })
  it('a `to` filter keeps only trains that reach the destination, with an arrival time', async () => {
    const d = await deps('/v1/train/stops/central/departures?to=ferny-grove&limit=10')
    expect(d.departures.length).toBeGreaterThan(0)
    for (const x of d.departures) {
      expect(x.schedArrTo).not.toBeNull()
      expect(x.stopsAfter?.some((id) => platformOf(id)?.station.key === 'ferny-grove')).toBe(true)
    }
  })
})

describe('golden: Bowen Hills (branching)', () => {
  it('to Doomben and to Ferny Grove return different, branch-correct services', async () => {
    const doomben = await deps('/v1/train/stops/bowen-hills/departures?to=doomben&limit=10')
    const fg = await deps('/v1/train/stops/bowen-hills/departures?to=ferny-grove&limit=10')
    const ids = new Set(doomben.departures.map((d) => d.tripInstance))
    expect(fg.departures.some((d) => ids.has(d.tripInstance))).toBe(false)
    for (const d of doomben.departures) expect(d.route.short).toMatch(/DB/)
  })
})

describe('golden: Domestic Airport and cross-midnight', () => {
  it('after the last train, the board rolls over to tomorrow’s first trains', async () => {
    const late = gtfsToEpoch('20261020', 23 * 3600 + 30 * 60) * 1000
    const d = await deps('/v1/train/stops/domestic-airport/departures?limit=3', late)
    expect(d.departures.length).toBeGreaterThan(0)
    expect(d.departures[0]?.tripInstance.endsWith('@20261021')).toBe(true)
    expect(d.departures[0]?.schedDep).toBeGreaterThan(late / 1000 + 4 * 3600)
  })
  it('a 00:10 query still shows yesterday’s service day trips running past 24:00', async () => {
    // Find a boarding after 24:00 in the timetable, and its station.
    const trips = (fixture as { tripIndex: { stops: string[]; trips: Array<{ id: string; st: number[] }> } })
      .tripIndex
    let found: { station: string; dep: number; id: string } | null = null
    for (const t of trips.trips)
      for (let i = 0; i + 11 < t.st.length; i += 6)
        if ((t.st[i + 3] as number) >= 24 * 3600 + 15 * 60 && !found)
          found = {
            station: platformOf(trips.stops[t.st[i] as number] as string)?.station.key ?? '',
            dep: t.st[i + 3] as number,
            id: t.id,
          }
    expect(found).not.toBeNull()
    const f = found as NonNullable<typeof found>
    const at = gtfsToEpoch('20261020', f.dep - 10 * 60) * 1000 // 20 Oct service day, after midnight on the 21st
    const d = await deps(`/v1/train/stops/${f.station}/departures?limit=40`, at)
    expect(d.departures.some((x) => x.tripInstance === `${f.id}@20261020`)).toBe(true)
  })
})
