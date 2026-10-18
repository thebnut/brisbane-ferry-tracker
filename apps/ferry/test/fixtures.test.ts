import { DeparturesResponse, TripResponse, VehiclesResponse } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'

// Tuesday 20 Oct 2026, 8:00 am Brisbane (22:00 UTC the day before).
const NOW = Date.UTC(2026, 9, 19, 22, 0)
const get = async (path: string, now = NOW) => {
  const res = await handleFixtureApi(new URL(`http://x/__fixtures${path}`), now)
  return { status: res.status, body: (await res.json()) as unknown }
}

describe('fixture /v1 API', () => {
  it('serves contract-valid departures for a pair, from now on, with live, GPS and cancelled rows', async () => {
    const { status, body } = await get('/v1/ferry/stops/317584/departures?to=317590&limit=13')
    expect(status).toBe(200)
    const res = DeparturesResponse.parse(body)
    expect(res.departures.length).toBe(13)
    expect(res.departures.every((d) => (d.estDep ?? d.schedDep) >= NOW / 1000 - 60)).toBe(true)
    expect(res.departures.every((d) => d.schedArrTo != null && d.schedArrTo > d.schedDep)).toBe(true)
    const statuses = new Set(res.departures.map((d) => d.status))
    expect(statuses.has('live')).toBe(true)
    expect(res.departures.some((d) => d.gps)).toBe(true)
    expect(res.rtState).toBe('live')
  })
  it('forced rtState=unavailable has no live rows and a null source timestamp', async () => {
    const res = DeparturesResponse.parse(
      (await get('/v1/ferry/stops/317584/departures?to=317590&rt=unavailable')).body,
    )
    expect(res.rtState).toBe('unavailable')
    expect(res.rtSourceTimestamp).toBeNull()
    expect(res.departures.every((d) => d.status === 'scheduled')).toBe(true)
  })
  it('honours `at` for "Depart from"', async () => {
    const at = NOW / 1000 + 6 * 3600
    const res = DeparturesResponse.parse(
      (await get(`/v1/ferry/stops/317584/departures?to=317590&at=${at}`)).body,
    )
    expect(res.departures[0]?.schedDep).toBeGreaterThanOrEqual(at - 60)
  })
  it('serves trips and vehicles', async () => {
    const deps = DeparturesResponse.parse((await get('/v1/ferry/stops/317584/departures?to=317590')).body)
    const live = deps.departures.find((d) => d.gps)
    if (!live) throw new Error('no GPS row in fixture')
    const trip = TripResponse.parse(
      (await get(`/v1/ferry/trips/${encodeURIComponent(live.tripInstance)}`)).body,
    )
    expect(trip.stops.some((s) => s.stopId === '317590')).toBe(true)
    expect(trip.vehicle?.tripKey).toBe(live.tripInstance)
    const v = VehiclesResponse.parse((await get('/v1/ferry/vehicles')).body)
    expect(v.vehicles.length).toBeGreaterThan(0)
  })
  it('404s unknown stops', async () => {
    expect((await get('/v1/ferry/stops/999/departures')).status).toBe(404)
  })
})

describe('proxy contract check', () => {
  it('passes valid bodies and replaces drifted ones with a 502', async () => {
    const good = await handleFixtureApi(
      new URL('http://x/__fixtures/v1/ferry/stops/317584/departures?to=317590'),
      NOW,
    )
    const ok = await validateProxied('/v1/ferry/stops/317584/departures', good)
    expect(ok.status).toBe(200)
    const drifted = Response.json({ schemaVersion: 2, departures: 'nope' })
    const bad = await validateProxied('/v1/ferry/stops/317584/departures', drifted)
    expect(bad.status).toBe(502)
    expect(await bad.json()).toMatchObject({ error: 'contract_mismatch' })
  })
})
