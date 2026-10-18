/**
 * Fixture API and static client data against the contracts, plus the busiest-stop payload budget
 * (transit-architecture.md §7 phase 6: busiest-stop /v1 departures < 20 KB).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { AlertsResponse, DeparturesResponse, TripResponse, VehiclesResponse } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { GeoTileFile, LinesFile, RouteFile, StopIndexFile } from '../app/lib/data-contract.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'

// Tuesday 20 Oct 2026, 8:15 am Brisbane (UTC+10): peak hour.
const NOW = Date.UTC(2026, 9, 19, 22, 15)
const get = async (path: string) => {
  const res = await handleFixtureApi(new URL(`http://x/__fixtures${path}`), NOW)
  return { res, body: res.ok ? await res.json() : null }
}

describe('fixture /v1 API', () => {
  it('departures for every fixture stop are contract-valid and sorted', async () => {
    for (const id of ['10802', '11168', '10780', '10781', '19051', '37']) {
      const { res, body } = await get(`/v1/bus/stops/${id}/departures?limit=20`)
      expect(res.status, id).toBe(200)
      const d = DeparturesResponse.parse(body)
      expect(d.departures.length).toBe(20)
      const at = d.departures.map((x) => x.estDep ?? x.schedDep)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
      expect(d.departures.some((x) => x.status === 'live')).toBe(true)
    }
  })

  it('busway platforms carry their platform code', async () => {
    const { body } = await get('/v1/bus/stops/10802/departures')
    expect(DeparturesResponse.parse(body).departures[0]?.platform).toBe('1')
  })

  it('busiest stop: departures payload is under 20 KB (limit 20, and even limit 100 gzipped)', async () => {
    const { body } = await get('/v1/bus/stops/11168/departures?limit=20')
    const raw = JSON.stringify(body)
    expect(raw.length).toBeLessThan(20 * 1024)
    const { body: big } = await get('/v1/bus/stops/11168/departures?limit=100')
    expect(gzipSync(JSON.stringify(big)).length).toBeLessThan(20 * 1024)
  })

  it('unknown stop is a 404', async () => {
    expect((await get('/v1/bus/stops/nope/departures')).res.status).toBe(404)
  })

  it('trips (trip index and stop-day fallback), vehicles and alerts are contract-valid', async () => {
    const { body } = await get('/v1/bus/stops/10802/departures?limit=40')
    const d = DeparturesResponse.parse(body)
    const m2 = d.departures.find((x) => x.route.short === 'M2')
    const other = d.departures.find((x) => !['M1', 'M2', '60'].includes(x.route.short))
    for (const t of [m2, other]) {
      expect(t).toBeDefined()
      const r = await get(`/v1/bus/trips/${encodeURIComponent(t?.tripInstance ?? '')}`)
      expect(r.res.status).toBe(200)
      const trip = TripResponse.parse(r.body)
      expect(trip.stops.some((s) => s.stopId === '10802')).toBe(true)
    }
    const v = VehiclesResponse.parse((await get('/v1/bus/vehicles?route=M2')).body)
    expect(v.vehicles.length).toBeGreaterThan(0)
    expect(v.vehicles.every((x) => x.routeId?.startsWith('M2'))).toBe(true)
    const a = AlertsResponse.parse((await get('/v1/alerts?mode=bus')).body)
    expect(a.alerts.length).toBe(4)
  })

  it('forced rt states', async () => {
    const { body } = await get('/v1/bus/stops/10802/departures?rt=unavailable')
    const d = DeparturesResponse.parse(body)
    expect(d.rtState).toBe('unavailable')
    expect(d.departures.every((x) => x.status === 'scheduled')).toBe(true)
  })

  it('fixture client data subsets are contract-valid', async () => {
    StopIndexFile.parse((await get('/data/bus/stops.json')).body)
    LinesFile.parse((await get('/data/bus/lines.json')).body)
    const r = RouteFile.parse((await get('/data/bus/routes/M2.json')).body)
    expect(r.patterns[0]?.stops.length).toBeGreaterThan(5)
    GeoTileFile.parse((await get('/data/bus/geo/r7hgd.json')).body)
    // An empty cell is an empty tile, as the API answers it (X2).
    expect(GeoTileFile.parse((await get('/data/bus/geo/zzzzz.json')).body).stops).toEqual([])
  })
})

const dir = join(__dirname, '../public/data/bus')
describe.runIf(existsSync(join(dir, 'stops.json')))('built client data (pnpm data)', () => {
  const read = (p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8'))
  it('lines, every geo tile and every route file match the contract', () => {
    LinesFile.parse(read('lines.json'))
    const tiles = readdirSync(join(dir, 'geo'))
    expect(tiles.length).toBeGreaterThan(100)
    for (const t of tiles) {
      const tile = GeoTileFile.parse(read(`geo/${t}`))
      expect(`${tile.geohash}.json`).toBe(t)
    }
    for (const f of readdirSync(join(dir, 'routes'))) RouteFile.parse(read(`routes/${f}`))
  })
  it('stays inside the Workers Free 20k static files per version', () => {
    const n = readdirSync(join(dir, 'geo')).length + readdirSync(join(dir, 'routes')).length + 2
    expect(n).toBeLessThan(5000)
  })
})
