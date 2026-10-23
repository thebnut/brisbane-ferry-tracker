import type { Departure } from '@bft/core/contract'
import { generateTimeSlots } from '@bft/ui/board-header'
import { describe, expect, it } from 'vitest'
import {
  applyFilter,
  asScheduled,
  bannerState,
  boardState,
  hasExpress,
  rowModel,
  visibleRows,
} from '../app/lib/departures.ts'

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

describe('rowModel (THE-118 PR 4)', () => {
  it('express live row: service tile, headsign, "Live · on time", arr fact, countdown', () => {
    const r = rowModel(dep({}), NOW)
    expect(r).toMatchObject({
      code: 'F11',
      express: true,
      destination: 'Riverside',
      time: '7:42 pm',
      arrival: '7:54 pm',
      journey: '12 mins',
      fact: 'arr 7:54 pm',
      minutes: 4,
      status: { status: 'live', dot: 'live', text: 'Live · on time', claim: true },
    })
    // The vessel, the journey line and badges are off the row now (trip detail has them).
    expect(JSON.stringify(r)).not.toContain('Mooroolbin')
  })
  it('late and early rows say so from the clocks shown', () => {
    const late = rowModel(
      dep({ route: { id: 'F1', short: 'F1' }, schedDep: s(19, 46), estDep: s(19, 49) }),
      NOW,
    )
    expect(late.status).toMatchObject({ text: 'Live · 3 min late', tone: 'late' })
    expect(late.express).toBe(false)
    expect(rowModel(dep({ schedDep: s(19, 46), estDep: s(19, 45) }), NOW).status.text).toBe(
      'Live · 1 min early',
    )
    expect(rowModel(dep({ status: 'scheduled', estDep: null, gps: false }), NOW).status).toMatchObject({
      text: 'Scheduled',
      claim: false,
    })
  })
  it('cancelled row: no countdown, no arrival, the next like it', () => {
    const c = dep({ status: 'cancelled', estDep: null, gps: false })
    const r = rowModel(c, NOW, dep({ schedDep: s(19, 58), estDep: s(19, 58) }))
    expect(r).toMatchObject({ minutes: null, arrival: null, fact: null })
    expect(r.status).toMatchObject({ dot: 'cancelled', text: 'Cancelled · next F11 in 20 min' })
    expect(rowModel(dep({ status: 'skipped' }), NOW).status.text).toBe('Not stopping here')
  })
  it('an extra service (rt: key) says so, never on time, late or early (R35-U1)', () => {
    const extra = dep({ tripInstance: 'rt:EXTRA@20261018', schedDep: s(19, 46), estDep: s(19, 46) })
    expect(rowModel(extra, NOW).status).toMatchObject({ text: 'Live · Extra service', claim: true })
  })
  it('headsigns lose " ferry terminal"', () => {
    expect(rowModel(dep({ headsign: 'Northshore Hamilton ferry terminal' }), NOW).destination).toBe(
      'Northshore Hamilton',
    )
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
  it('live only while the TransLink source and the response itself are fresh', () => {
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
    expect(boardState(res, false, NOW)).toBeNull()
    expect(boardState(res, true, NOW)).toBe('offline')
    // Generated over a minute ago (failing refreshes, or a copy from the service worker's cache that was fetched just
    // now): stale, even though the body says live. Judged on the data's own timestamp, not the fetch time.
    expect(boardState({ ...res, generatedAt: NOW - 90_000 }, false, NOW)).toBe('stale')
    expect(boardState({ ...res, rtSourceTimestamp: NOW / 1000 - 400 }, false, NOW)).toBe('stale')
    expect(boardState({ ...res, rtState: 'unavailable' }, false, NOW)).toBe('unavailable')
  })
  it('re-sorts by timetable time when live estimates are dropped', () => {
    const late = dep({ tripInstance: 'a@20261018', schedDep: s(19, 45), estDep: s(19, 50) })
    const next = dep({ tripInstance: 'b@20261018', schedDep: s(19, 48), estDep: s(19, 48) })
    // Live order: b (7:48) before a (7:50); timetable order: a (7:45) before b.
    expect(visibleRows([next, late], 'stale', NOW).map((d) => d.tripInstance)).toEqual([
      'a@20261018',
      'b@20261018',
    ])
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

describe('bannerState (R6-B1, Codex review round 5)', () => {
  it('offline when either board shows an offline copy, whatever the other says', () => {
    expect(bannerState([null, 'offline'])).toBe('offline')
    expect(bannerState(['stale', 'offline'])).toBe('offline')
    expect(bannerState(['stale', null])).toBe('stale')
    expect(bannerState([null, null])).toBeNull()
    expect(bannerState([])).toBeNull()
  })
})

describe('ServiceTile (THE-118 PR 4)', () => {
  it('is a circle: orange for express, aqua for all stops', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { ServiceTile } = await import('../app/components/DepartureList.tsx')
    expect(renderToStaticMarkup(<ServiceTile code="F11" express />)).toMatch(
      /rounded-full[^"]*bg-ferry-orange-aa/,
    )
    expect(renderToStaticMarkup(<ServiceTile code="F1" />)).toMatch(/rounded-full[^"]*bg-aqua-text/)
  })
})
