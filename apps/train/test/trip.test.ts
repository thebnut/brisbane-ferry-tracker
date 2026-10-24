import type { TripResponse } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { corridorFor, stationByKey } from '../app/lib/network.ts'
import { buildTimeline, positionOf } from '../app/lib/trip.ts'

const T0 = Date.UTC(2026, 9, 19, 22, 0) / 1000 // 8:00 am Brisbane

/** An express from Roma Street to Ferny Grove calling at every other station, 2 minutes apart. */
function trip(): TripResponse {
  const all = corridorFor(['roma-street', 'ferny-grove'])
  const calls = all.filter((_, i) => i % 2 === 0 || i === all.length - 1)
  return {
    schemaVersion: 1,
    staticGeneration: 'g',
    serviceDates: ['20261020'],
    rtSourceTimestamp: T0,
    rtState: 'live',
    generatedAt: T0 * 1000,
    mode: 'train',
    tripInstance: 'X@20261020',
    route: { id: 'BRFG-1', short: 'BRFG', long: 'Brisbane City - Ferny Grove', color: 'D53E45' },
    headsign: 'Ferny Grove station',
    status: 'live',
    vehicle: null,
    stops: calls.map((k, i) => ({
      stopId: stationByKey(k)?.platforms[0]?.id ?? k,
      stopSequence: i + 1,
      schedArr: T0 + i * 120,
      schedDep: T0 + i * 120 + (i === 1 ? 60 : 0),
      estArr: null,
      estDep: null,
      status: 'live',
      pickup: 0,
      dropOff: 0,
    })),
  }
}

describe('service detail timeline', () => {
  it('lists every corridor station, with passed-through ones as "skip" rows', () => {
    const t = trip()
    const { rows } = buildTimeline(t, T0 - 600, 'roma-street', null)
    expect(rows.map((r) => r.stationKey)).toEqual(corridorFor(['roma-street', 'ferny-grove']))
    const skips = rows.filter((r) => r.kind === 'skip')
    expect(skips.length).toBeGreaterThan(0)
    expect(skips.every((r) => r.stop === null && r.note === 'Passes, no stop')).toBe(true)
    expect(rows.at(-1)?.kind).toBe('terminus')
  })
  it('shows separate arrival and departure times when they differ, and platforms', () => {
    const { rows } = buildTimeline(trip(), T0 - 600, null, null)
    const second = rows.filter((r) => r.stop)[1]
    expect(second?.arr).not.toBe(second?.dep)
    expect(String(second?.note)).toMatch(/platform/i)
  })
  it('marks your destination and the stations already passed', () => {
    const { rows } = buildTimeline(trip(), T0 + 300, 'roma-street', 'ferny-grove')
    expect(rows[0]?.kind).toBe('passed')
    expect(rows.at(-1)?.kind).toBe('you')
  })
  it('places the train between stations by time (moving capsule)', () => {
    const { rows } = buildTimeline(trip(), T0 + 30, null, null)
    const { position, positionLabel } = positionOf(rows, T0 + 30)
    expect(position).toBeGreaterThan(0)
    expect(position).toBeLessThan(2)
    expect(positionLabel).toMatch(/^Between /)
    expect(positionOf(rows, T0 - 3600).position).toBeNull()
  })
})

describe('an unplanned train (R35-U1)', () => {
  /** An ADDED trip as /v1 sends it: live estimates and no timetable at any stop. */
  function unplanned(): TripResponse {
    const t = trip()
    return {
      ...t,
      tripInstance: 'rt:UNPLANNED@20261020',
      headsign: 'Ferny Grove station',
      stops: t.stops.map((s, i) => ({
        ...s,
        schedArr: null,
        schedDep: null,
        estArr: T0 + i * 120,
        estDep: T0 + i * 120 + 30,
      })),
    }
  }

  it('shows its live times and never a delay measured from 0', () => {
    const { rows } = buildTimeline(unplanned(), T0 - 600, 'roma-street', null)
    const calls = rows.filter((r) => r.stop)
    expect(calls.every((r) => r.delay == null)).toBe(true)
    expect(calls[0]?.dep).toBe('8:00 am')
    expect(calls[1]).toMatchObject({ arr: '8:02 am', dep: '8:02 am' })
    expect(calls.at(-1)?.dep).toBeNull()
    expect(calls.at(-1)?.arr).not.toBeNull()
  })

  it('a timetabled train keeps its delays', () => {
    const t = trip()
    const late = { ...t, stops: t.stops.map((s) => ({ ...s, estDep: (s.schedDep as number) + 180 })) }
    const { rows } = buildTimeline(late, T0 - 600, 'roma-street', null)
    expect(rows.find((r) => r.stop)?.delay).toBe('3 min late')
  })
})
