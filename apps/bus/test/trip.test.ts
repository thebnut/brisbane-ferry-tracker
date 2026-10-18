import type { TripResponse, TripStop } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { timeline } from '../app/lib/trip.ts'

const T0 = 1_792_300_000
const stop = (id: string, i: number): TripStop => ({
  stopId: id,
  name: `Stop ${id}`,
  stopSequence: i + 1,
  schedArr: T0 + i * 120,
  schedDep: T0 + i * 120,
  estArr: null,
  estDep: null,
  status: 'scheduled',
  pickup: 0,
  dropOff: 0,
})
const trip = (vehicle: TripResponse['vehicle']): TripResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261018'],
  rtSourceTimestamp: T0,
  rtState: 'live',
  generatedAt: T0 * 1000,
  mode: 'bus',
  tripInstance: 't@20261018',
  route: { id: 'M2-1', short: 'M2' },
  headsign: 'UQ Lakes',
  status: 'live',
  vehicle,
  stops: ['a', 'b', 'c', 'd'].map(stop),
})

describe('trip timeline', () => {
  it('puts the bus at the stop it reports, past before, terminus last', () => {
    const v = { id: 'v', lat: 0, lon: 0, ts: T0, stopId: 'b', status: 'STOPPED_AT' }
    const t = timeline(trip(v), 'c', (T0 + 130) * 1000)
    expect(t.map((s) => s.kind)).toEqual(['past', 'here', 'here', 'end'])
    expect(t[1]?.meta).toBe('Bus is here')
    expect(t[2]?.meta).toBe('Your stop')
    expect(t[3]?.meta).toContain('Terminus')
  })
  it('without a position, stops whose time has passed are past', () => {
    const t = timeline(trip(null), null, (T0 + 250) * 1000)
    expect(t.map((s) => s.kind)).toEqual(['past', 'past', 'past', 'end'])
  })
})
