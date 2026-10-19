/**
 * Smoke round 9: one ferry row read "F1 3:34, sched 2:15, 79 min late". TransLink's arrival at a trip's origin is
 * the inbound vessel's ETA from its previous block run, while the departure there is stated separately (delay 0).
 * Clamping the stated departure to that ETA showed a LIVE departure the feed never gave. These run a crafted feed
 * through the hub's buildSnapshot and core's mergeDepartures, as the Worker does.
 */
import { type Departure, mergeDepartures, type RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { type SynthTrip, stopDay, tripIndex } from '../../../packages/core/test/helpers.ts'
import { FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { buildSnapshot, ModeIndex } from '../src/rt/build.ts'
import { D, D0, epoch, feed, tripUpdate } from './fixtures.ts'

const UQ = '319665'
const WEST_END = '317574'
const GUYATT = '317572'
const uq = (id: string, start: string, west: string, guyatt: string): SynthTrip => ({
  id,
  route: 'F1-4055',
  headsign: 'Northshore Hamilton',
  stops: [
    [UQ, start],
    [WEST_END, west],
    [GUYATT, guyatt],
  ],
})
// The same trip_id runs on both days (TransLink reuses trip ids across dates of one service pattern).
const TRIPS: Record<string, SynthTrip[]> = {
  [D0]: [
    uq('F1-1415', '14:15:00', '14:20:00', '14:25:00'),
    uq('F1-1815', '18:15:00', '18:20:00', '18:25:00'),
  ],
  [D]: [uq('F1-1415', '14:15:00', '14:20:00', '14:25:00')],
}

type Stu = Parameters<typeof tripUpdate>[2]

function snapshotFor(
  startDate: string,
  stus: Stu,
  nowS: number,
  opts: {
    tripId?: string
    startTime?: string
    directionId?: number
    rel?: number
    vehicles?: Parameters<typeof feed>[1]
  } = {},
): RtSnapshot {
  const index = new ModeIndex('ferry', [tripIndex(D0, TRIPS[D0] ?? []), tripIndex(D, TRIPS[D] ?? [])])
  const trip = {
    tripId: opts.tripId ?? 'F1-1415',
    startDate,
    startTime: opts.startTime ?? '14:15:00',
    routeId: 'F1-4055',
    ...(opts.rel != null ? { scheduleRelationship: opts.rel } : {}),
    ...(opts.directionId != null ? { directionId: opts.directionId } : {}),
  }
  const fm = fromBinary(FeedMessageSchema, feed(nowS, [tripUpdate('e', trip, stus, 'Kuluwin')]))
  const vp = fromBinary(FeedMessageSchema, feed(nowS, opts.vehicles ?? []))
  return buildSnapshot({
    seq: 1,
    nowMs: nowS * 1000,
    indexes: { ferry: index },
    tripUpdates: [{ mode: 'ferry', feed: fm }],
    vehiclePositions: [{ mode: 'ferry', feed: vp }],
    alerts: [],
  }).snapshot
}

function board(date: string, stop: string, snap: RtSnapshot, nowS: number): Departure[] {
  return mergeDepartures([stopDay(date, stop, TRIPS[date] ?? [])], snap, { nowS, rtState: 'live' })
}

describe('79-min-late ferry row (smoke round 9)', () => {
  const now = epoch(D0, '14:05:00')

  it("ignores the inbound vessel's ETA at the trip's origin when the departure is stated", () => {
    const snap = snapshotFor(
      D0,
      [
        { seq: 1, stopId: UQ, arrTime: epoch(D0, '15:34:00'), depTime: epoch(D0, '14:15:00'), depDelay: 0 },
        { seq: 2, stopId: WEST_END, arrDelay: 0, depDelay: 0 },
      ],
      now,
    )
    const [row] = board(D0, UQ, snap, now)
    expect(row).toMatchObject({
      tripInstance: `F1-1415@${D0}`,
      status: 'live',
      estDep: epoch(D0, '14:15:00'),
    })
  })

  it('keeps an early inbound ETA at the origin from moving the departure (feed shape of 18 Oct)', () => {
    const snap = snapshotFor(D0, [{ seq: 1, stopId: UQ, arrDelay: -2062, depDelay: 0 }], now)
    const [row] = board(D0, UQ, snap, now)
    expect(row).toMatchObject({ status: 'live', estDep: epoch(D0, '14:15:00') })
  })

  it("never puts one day's update on another day's run of the same trip_id", () => {
    const snap = snapshotFor(D0, [{ seq: 1, stopId: UQ, depDelay: 600 }], now)
    expect(Object.keys(snap.trips)).toEqual([`F1-1415@${D0}`])
    const tomorrow = epoch(D, '14:05:00')
    const [row] = board(D, UQ, snap, tomorrow)
    expect(row).toMatchObject({ tripInstance: `F1-1415@${D}`, status: 'scheduled', estDep: null })
  })

  it('shows a huge delay the feed states at that stop, but not when it is only propagated downstream', () => {
    const snap = snapshotFor(D0, [{ seq: 1, stopId: UQ, depDelay: 79 * 60 }], now)
    const [origin] = board(D0, UQ, snap, now)
    expect(origin).toMatchObject({ status: 'live', estDep: epoch(D0, '15:34:00') })
    const [west] = board(D0, WEST_END, snap, now)
    expect(west).toMatchObject({ status: 'scheduled', estDep: null })
  })

  it('still clamps at an intermediate stop, where the arrival is a real prediction for this trip', () => {
    const snap = snapshotFor(D0, [{ seq: 2, stopId: WEST_END, arrDelay: 300, depDelay: 0 }], now)
    const [row] = board(D0, WEST_END, snap, now)
    expect(row).toMatchObject({ status: 'live', estDep: epoch(D0, '14:25:00') })
  })

  it('does not show LIVE when the intermediate-stop clamp alone would make it over an hour late', () => {
    const snap = snapshotFor(D0, [{ seq: 2, stopId: WEST_END, arrDelay: 79 * 60, depDelay: 0 }], now)
    const [row] = board(D0, WEST_END, snap, now)
    expect(row).toMatchObject({ status: 'scheduled', estDep: null })
  })

  it('trusts an hour-plus arrival-only delay as an arrival, but not as a departure (Codex r1 #1)', () => {
    const snap = snapshotFor(D0, [{ seq: 2, stopId: WEST_END, arrDelay: 79 * 60 }], now)
    const [boarding] = board(D0, WEST_END, snap, now)
    expect(boarding).toMatchObject({ status: 'scheduled', estDep: null })
    const [toWestEnd] = mergeDepartures([stopDay(D0, UQ, TRIPS[D0] ?? [])], snap, {
      nowS: now,
      rtState: 'live',
      toStopIds: new Set([WEST_END]),
    })
    expect(toWestEnd).toMatchObject({ schedArrTo: epoch(D0, '14:20:00'), estArrTo: epoch(D0, '15:39:00') })
  })

  it("applies the origin rule to an ADDED trip's first stop (Codex r1 #2)", () => {
    const snap = snapshotFor(
      D0,
      [
        { stopId: UQ, arrTime: epoch(D0, '15:34:00'), depTime: epoch(D0, '14:15:00') },
        { stopId: WEST_END, arrTime: epoch(D0, '14:20:00'), depTime: epoch(D0, '14:20:00') },
      ],
      now,
      { tripId: 'EXTRA', rel: 1 },
    )
    const added = snap.trips[`rt:EXTRA@${D0}`]?.added
    expect(added?.stops[0]).toMatchObject({
      stopId: UQ,
      arr: epoch(D0, '14:15:00'),
      dep: epoch(D0, '14:15:00'),
    })
  })

  it("matches a conflicting start_time to the run it names, never to the trip_id's other run (Codex r1 #3)", () => {
    // F1-1415's id with the 18:15 start: tier 2 finds the 18:15 run by (route, direction, start_time).
    const at = (tripId: string, startTime: string) => ({
      id: 'Kuluwin',
      vehicle: {
        trip: { tripId, startDate: D0, startTime },
        vehicle: { id: 'Kuluwin' },
        position: { latitude: -27.5, longitude: 153 },
      },
    })
    const snap = snapshotFor(D0, [{ seq: 1, stopId: UQ, depDelay: 120 }], now, {
      startTime: '18:15:00',
      directionId: 0,
      vehicles: [at('F1-1415', '14:15:00')],
    })
    expect(Object.keys(snap.trips)).toEqual([`F1-1815@${D0}`])
    // A vehicle naming the 14:15 run is not attached to the 18:15 one through the descriptor shortcut.
    expect(snap.vehicles[0]?.tripKey).toBe(`F1-1415@${D0}`)
    const [row] = board(D0, UQ, snap, now)
    expect(row).toMatchObject({ tripInstance: `F1-1415@${D0}`, status: 'scheduled', gps: true })
  })

  it('without a direction to narrow it, a conflicting start_time stays unmatched', () => {
    const snap = snapshotFor(D0, [{ seq: 1, stopId: UQ, depDelay: 120 }], now, { startTime: '18:15:00' })
    expect(Object.keys(snap.trips)).toEqual([])
  })

  it('leaves a start_time that matches no run unmatched', () => {
    const snap = snapshotFor(D0, [{ seq: 1, stopId: UQ, depDelay: 120 }], now, { startTime: '16:15:00' })
    expect(Object.keys(snap.trips)).toEqual([])
  })
})
