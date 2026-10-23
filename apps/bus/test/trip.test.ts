import type { TripResponse, TripStop } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import type { RouteFile } from '../app/lib/data-contract.ts'
import { needsStopNames, stopNamesFor, timeline, unnamedStop } from '../app/lib/trip.ts'

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
  it('puts the bus at the stop it reports, past before, your stop the board row, terminus last', () => {
    const v = { id: 'v', lat: 0, lon: 0, ts: T0, stopId: 'b', status: 'STOPPED_AT' }
    const t = timeline(trip(v), 'c', (T0 + 130) * 1000)
    expect(t.rows.map((s) => s.kind)).toEqual(['passed', 'stop', 'stop', 'terminus'])
    expect(t.position).toBe(1)
    expect(t.positionLabel).toBe('The bus is at Stop b')
    expect(t.board).toBe(2)
    expect(t.rows[2]?.note).toBe('You board')
    expect(t.rows[3]?.note).toContain('Terminus')
  })
  it('a bus heading to a stop rides half way from the one before', () => {
    const v = { id: 'v', lat: 0, lon: 0, ts: T0, stopId: 'c', status: 'IN_TRANSIT_TO' }
    const t = timeline(trip(v), 'c', (T0 + 130) * 1000)
    expect(t.position).toBe(1.5)
    expect(t.positionLabel).toBe('The bus is heading to Stop c')
  })
  it('without a position, stops whose time has passed are passed; no capsule', () => {
    const t = timeline(trip(null), null, (T0 + 250) * 1000)
    expect(t.rows.map((s) => s.kind)).toEqual(['passed', 'passed', 'passed', 'terminus'])
    expect(t.position).toBeNull()
    expect(t.board).toBe(0)
  })
  it('names stops from the route file when the trip carries only ids (B1)', () => {
    const t = trip(null)
    t.stops = t.stops.map(({ name: _name, ...rest }) => rest)
    const route = {
      schemaVersion: 1,
      mode: 'bus',
      generation: 'g',
      short: 'M2',
      color: '000000',
      textColor: 'FFFFFF',
      patterns: [
        {
          directionId: 0,
          headsign: 'UQ Lakes',
          trips: 1,
          stops: [
            { key: 'a', name: 'Adelaide Street', lat: 0, lon: 0 },
            { key: 'c', name: 'Cultural Centre', lat: 0, lon: 0 },
            { key: 'z', name: 'Not on this trip', lat: 0, lon: 0 },
          ],
        },
      ],
    } as RouteFile
    const names = stopNamesFor(t, route)
    expect(names).toEqual({ a: 'Adelaide Street', c: 'Cultural Centre' })
    expect(timeline(t, null, T0 * 1000, names).rows.map((s) => s.name)).toEqual([
      'Adelaide Street',
      'Stop b',
      'Cultural Centre',
      'Stop d',
    ])
  })
  it('asks for the route file only when the API left a stop unnamed', () => {
    expect(needsStopNames(null)).toBe(false)
    expect(needsStopNames(trip(null))).toBe(false)
    const t = trip(null)
    t.stops = t.stops.map((s, i) => (i === 1 ? { ...s, name: undefined } : s))
    expect(needsStopNames(t)).toBe(true)
  })
  it('an unnamed numeric stop shows its stop number once, not "Stop 142 · Stop 000142"', () => {
    expect(unnamedStop('142')).toBe('Stop 000142')
    expect(unnamedStop('place_cannon')).toBe('Stop place_cannon')
    const t = trip(null)
    t.stops = ['142', '64', '1850', '4521'].map((id, i) => {
      const { name: _name, ...rest } = stop(id, i)
      return id === '64' ? { ...rest, name: 'Adelaide Street Stop 64 near Albert St' } : rest
    })
    const { rows } = timeline(t, null, (T0 - 60) * 1000)
    expect(rows.map((r) => r.name)).toEqual([
      'Stop 000142',
      'Adelaide Street Stop 64 near Albert St',
      'Stop 001850',
      'Stop 004521',
    ])
    // A named stop still shows its stop number in the meta line; an unnamed one already has it as its name.
    expect(rows[0]?.note).toBeUndefined()
    expect(rows[1]?.note).toBe('Stop 000064')
    expect(rows[2]?.note).toBeUndefined()
  })
})
