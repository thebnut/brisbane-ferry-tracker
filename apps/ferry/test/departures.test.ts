import type { Departure } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import {
  applyFilter,
  asScheduled,
  boardState,
  cardModel,
  hasExpress,
  visibleRows,
} from '../app/lib/departures.ts'
import { generateTimeSlots } from '../app/lib/timeSlots.ts'

const NOW = Date.UTC(2026, 9, 18, 9, 38) // 7:38 pm Brisbane
const s = (h: number, m: number) => Date.UTC(2026, 9, 18, h - 10, m) / 1000
const dep = (o: Partial<Departure>): Departure => ({
  tripInstance: 't1@20261018',
  stopSequence: 3,
  route: { id: 'F11-4055', short: 'F11' },
  headsign: 'Riverside',
  directionId: 0,
  stopId: '317584',
  platform: null,
  schedDep: s(19, 42),
  estDep: s(19, 42),
  schedArrTo: s(19, 54),
  estArrTo: s(19, 54),
  status: 'live',
  gps: true,
  vehicleId: 'abc_MOOROOLBIN II',
  ...o,
})

describe('cardModel', () => {
  it('express live row: highlighted, badges, vessel and Sched Dept note, countdown', () => {
    const c = cardModel(dep({}), NOW)
    expect(c).toMatchObject({
      time: '7:42 pm',
      arrival: { time: '7:54 pm' },
      badges: ['live', 'gps'],
      service: 'EXPRESS · F11',
      highlighted: true,
      minutes: 4,
      note: 'Mooroolbin II · Sched Dept: 7:42 pm',
      journey: '12 mins',
    })
  })
  it('late row shows the scheduled time and lateness', () => {
    const c = cardModel(
      dep({ route: { id: 'F1', short: 'F1' }, schedDep: s(19, 46), estDep: s(19, 49) }),
      NOW,
      'x',
    )
    expect(c.note).toContain('Scheduled: 7:46 pm')
    expect(c.delay).toBe('3 min late')
    expect(c.highlighted).toBe(false)
  })
  it('cancelled row has no countdown', () => {
    const c = cardModel(dep({ status: 'cancelled', estDep: null, gps: false }), NOW)
    expect(c.minutes).toBeNull()
    expect(c.cancelled).toBe(true)
    expect(c.badges).toEqual(['cancelled'])
  })
  it('next-day departures get the (DD/MM) marker', () => {
    const c = cardModel(dep({ schedDep: s(29, 10), estDep: null, status: 'scheduled', gps: false }), NOW)
    expect(c.dayMarker).toBe('(19/10)')
  })
})

describe('board helpers', () => {
  it('express filter and detection over the first 13 rows', () => {
    const all = [dep({ route: { id: 'F1', short: 'F1' } }), dep({})]
    expect(applyFilter(all, 'express')).toHaveLength(1)
    expect(hasExpress(all)).toBe(true)
    expect(hasExpress([dep({ route: { id: 'F1', short: 'F1' } })])).toBe(false)
  })
  it('offline shows timetable times only', () => {
    expect(asScheduled(dep({}))).toMatchObject({ status: 'scheduled', estDep: null, gps: false })
    expect(boardState(undefined, true, NOW, NOW)).toBe('offline')
  })
  it('live only while the source and the last refresh are fresh', () => {
    const res = {
      schemaVersion: 1 as const,
      staticGeneration: 'g',
      serviceDates: [],
      rtSourceTimestamp: NOW / 1000 - 20,
      rtState: 'live' as const,
      generatedAt: NOW,
      mode: 'ferry' as const,
      stop: { key: 'a', name: 'A', stopIds: ['a'] },
      to: null,
      departures: [],
    }
    expect(boardState(res, false, NOW, NOW - 15_000)).toBeNull()
    // Refreshes failing for over a minute: stale, even though the last body said live.
    expect(boardState(res, false, NOW, NOW - 90_000)).toBe('stale')
    expect(boardState({ ...res, rtSourceTimestamp: NOW / 1000 - 400 }, false, NOW, NOW)).toBe('stale')
    expect(boardState({ ...res, rtState: 'unavailable' }, false, NOW, NOW)).toBe('unavailable')
  })
  it('drops departed rows and live claims when not live', () => {
    const rows = [dep({ schedDep: s(19, 30), estDep: s(19, 30) }), dep({})]
    expect(visibleRows(rows, null, NOW)).toHaveLength(1)
    expect(visibleRows([dep({})], 'stale', NOW)[0]).toMatchObject({ status: 'scheduled', gps: false })
  })
})

describe('Depart from slots', () => {
  it('starts two hours ahead on the hour, then tomorrow from 5 am', () => {
    const slots = generateTimeSlots(NOW) // 7:38 pm → 9 PM, 11 PM, Tomorrow, 5 AM ...
    expect(slots.map((x) => x.label)).toEqual([
      '9PM',
      '11PM',
      'Tomorrow',
      '5AM',
      '7AM',
      '9AM',
      '11AM',
      '1PM',
      '3PM',
      '5PM',
    ])
  })
})
