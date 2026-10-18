/**
 * Core changes made while building the edge (bft-edge, PR stacked on #38).
 *
 * 1. TransLink's after-midnight convention (found in the Phase 0 RtHub spike, Saturday 18 Oct 2026 Rail feed):
 * a trip filed in GTFS under service date D-1 at 24:18 arrives in GTFS-RT as start_date D, start_time 00:18.
 * 2. Vehicle.mode, so /v1/{mode}/vehicles can filter a combined snapshot.
 * 4. RtTrip.gen: the generation a record was matched against.
 * 3. TripMatcher.addDay and a memoised serviceDayStartEpoch, so the hub can rebuild matchers within Free-plan CPU.
 */
import { describe, expect, it } from 'vitest'
import { serviceDayStartEpoch, TripMatcher } from '../src/index.ts'
import { tripIndex } from './helpers.ts'

const D0 = '20261017'
const D = '20261018'
const late = {
  id: '39394522-QR 26_27-44453-1M17',
  route: 'BNBR-5202',
  dir: 0 as const,
  stops: [
    ['A', '24:18:00'],
    ['B', '24:40:00'],
  ] as Array<[string, string]>,
}

describe('after-midnight start_date convention', () => {
  const m = new TripMatcher('train', [tripIndex(D0, [late]), tripIndex(D, [{ ...late, id: 'OTHER' }])])

  it('tier 1 matches start_date D / 00:18 to the D-1 instance at 24:18', () => {
    const r = m.match({ tripId: late.id, startDate: D, startTime: '00:18:00' }, [])
    expect(r).toMatchObject({ kind: 'matched', tier: 1, key: `${late.id}@${D0}` })
  })

  it('does not match when the start times disagree', () => {
    const r = m.match({ tripId: late.id, startDate: D, startTime: '00:20:00' }, [])
    expect(r.kind).toBe('unmatched')
  })

  it('tier 2 applies the same convention', () => {
    const r = m.match({ routeId: 'BNBR-5202', directionId: 0, startDate: D, startTime: '00:18:00' }, [])
    expect(r).toMatchObject({ kind: 'matched', tier: 2, key: `${late.id}@${D0}` })
  })

  it('an exact start_date match still wins', () => {
    const r = m.match({ tripId: 'OTHER', startDate: D, startTime: '24:18:00' }, [])
    expect(r).toMatchObject({ kind: 'matched', tier: 1, key: `OTHER@${D}` })
  })
})

describe('Vehicle.mode', () => {
  it('is optional and must be a known mode', async () => {
    const { Vehicle } = await import('../src/index.ts')
    expect(Vehicle.parse({ id: 'v', lat: 1, lon: 2, ts: 3 }).mode).toBeUndefined()
    expect(Vehicle.parse({ id: 'v', mode: 'ferry', lat: 1, lon: 2, ts: 3 }).mode).toBe('ferry')
    expect(() => Vehicle.parse({ id: 'v', mode: 'boat', lat: 1, lon: 2, ts: 3 })).toThrow()
  })
})

describe('incremental matcher build', () => {
  it('addDay gives the same matches as building with both days', () => {
    const a = new TripMatcher('train', [tripIndex(D0, [late]), tripIndex(D, [{ ...late, id: 'OTHER' }])])
    const b = new TripMatcher('train', [])
    b.addDay(tripIndex(D0, [late]))
    b.addDay(tripIndex(D, [{ ...late, id: 'OTHER' }]))
    expect(b.serviceDates).toEqual(a.serviceDates)
    expect(b.size).toBe(a.size)
    const q = { tripId: late.id, startDate: D, startTime: '00:18:00' }
    expect(b.match(q, [])).toEqual(a.match(q, []))
  })

  it('serviceDayStartEpoch is memoised but still exact', () => {
    expect(serviceDayStartEpoch(D)).toBe(Date.parse('2026-10-17T14:00:00Z') / 1000)
    expect(serviceDayStartEpoch(D)).toBe(serviceDayStartEpoch(D))
  })
})

describe('RtTrip.gen', () => {
  it('is optional provenance', async () => {
    const { RtTrip } = await import('../src/index.ts')
    const base = { key: 'T@20261020', rel: 'CANCELED', ts: 1, updates: [] }
    expect(RtTrip.parse(base).gen).toBeUndefined()
    expect(RtTrip.parse({ ...base, gen: 'g1' }).gen).toBe('g1')
  })
})
