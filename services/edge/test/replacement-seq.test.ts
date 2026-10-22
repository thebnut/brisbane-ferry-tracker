/**
 * Smoke round 20 (R20-T1): a REPLACEMENT train left Central at 10:28 yet the board still showed it LIVE at Central,
 * "10:46, 19 min late". TransLink renumbers a replacement trip's stop_sequence from 1 where it joins the static
 * pattern, so feed seq 11 (Graceville, 10:46:38) landed on static seq 11 (Central). Updates are now placed by
 * stop_id. These run crafted feeds through the hub's buildSnapshot and core's mergeDepartures, as the Worker does.
 */
import { type Departure, mergeDepartures, type RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { type SynthTrip, stopDay, tripIndex } from '../../../packages/core/test/helpers.ts'
import { FeedMessageSchema, TripDescriptor_ScheduleRelationship } from '../src/gen/gtfs-realtime_pb.js'
import { buildSnapshot, ModeIndex } from '../src/rt/build.ts'
import { D, epoch, feed, tripUpdate } from './fixtures.ts'

const REPLACEMENT = TripDescriptor_ScheduleRelationship.REPLACEMENT
const SKIPPED = 1

const hms = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':')

// The static trip TransLink replaced (stop ids as in the feed, 22 Oct): Petrie line to Springfield via Central.
const PATTERN = (
  '600478 600474 600472 600469 600467 600627 600409 600401 600002 600010 ' +
  '600019 600029 600279 600283 600287 600291 600295 600299 600303 600309'
).split(' ')
const CENTRAL = '600019'
const GRACEVILLE = '600303'
const START_S = 9 * 3600 + 35 * 60
const sched = (seq: number) => START_S + (seq - 1) * 204
const TRIP_ID = '39764447-QR 26_27-44634-D524'
const KEY = `${TRIP_ID}@${D}`
const TRAIN: SynthTrip = {
  id: TRIP_ID,
  route: 'SPBR-4398',
  headsign: 'Springfield Central',
  stops: PATTERN.map((s, i) => [s, hms(sched(i + 1))] as [string, string]),
}
// A loop that visits A twice (seqs 1 and 4).
const LOOP: SynthTrip = {
  id: 'LOOP',
  route: 'L1-1',
  headsign: 'Loop',
  stops: [
    ['A', '10:00:00'],
    ['B', '10:10:00'],
    ['C', '10:20:00'],
    ['A', '10:30:00'],
  ],
}
// A plain three-stop trip (Codex review r1, finding 4).
const XYZ: SynthTrip = {
  id: 'XYZ',
  route: 'L1-1',
  headsign: 'Z',
  stops: [
    ['X', '10:00:00'],
    ['Y', '10:10:00'],
    ['Z', '10:20:00'],
  ],
}
const TRIPS = [TRAIN, LOOP, XYZ]

type Stu = Parameters<typeof tripUpdate>[2]

function build(
  tripId: string,
  stus: Stu,
  nowS: number,
  opts: {
    rel?: number
    startDate?: string | null
    vehicles?: Parameters<typeof feed>[1]
    noTu?: boolean
  } = {},
) {
  const index = new ModeIndex('train', [tripIndex(D, TRIPS)])
  const trip = {
    tripId,
    ...(opts.startDate !== null ? { startDate: opts.startDate ?? D } : {}),
    ...(opts.rel != null ? { scheduleRelationship: opts.rel } : {}),
  }
  const fm = fromBinary(FeedMessageSchema, feed(nowS, opts.noTu ? [] : [tripUpdate('e', trip, stus)]))
  const vp = fromBinary(FeedMessageSchema, feed(nowS, opts.vehicles ?? []))
  return buildSnapshot({
    seq: 1,
    nowMs: nowS * 1000,
    indexes: { train: index },
    tripUpdates: [{ mode: 'train', feed: fm }],
    vehiclePositions: [{ mode: 'train', feed: vp }],
    alerts: [],
  }).snapshot
}

/** The trip's resolved updates, leaving out the NO_DATA barriers that dropped updates leave behind. */
const updates = (snap: RtSnapshot, key: string) =>
  (snap.trips[key]?.updates ?? [])
    .filter((u) => u.rel !== 'NO_DATA' || u.stopId)
    .map((u) => ({ seq: u.seq, stopId: u.stopId, dep: u.dep }))
const barriers = (snap: RtSnapshot, key: string) =>
  (snap.trips[key]?.updates ?? []).filter((u) => u.rel === 'NO_DATA' && !u.stopId).map((u) => u.seq)

function board(stop: string, snap: RtSnapshot, nowS: number): Departure[] {
  return mergeDepartures([stopDay(D, stop, TRIPS)], snap, { nowS, rtState: 'live' })
}

/** The R20-T1 feed: renumbered from 1 at Bowen Hills (static seq 9); Central is feed seq 3, Graceville feed seq 11. */
const replacementStus = (): Stu =>
  PATTERN.slice(8).map((stopId, i) => {
    const seq = i + 1
    const t =
      stopId === CENTRAL
        ? epoch(D, '10:28:00')
        : stopId === GRACEVILLE
          ? epoch(D, '10:46:38')
          : epoch(D, hms(sched(seq + 8))) + 19 * 60
    return { seq, stopId, arrTime: t, depTime: t }
  })

describe('REPLACEMENT trip with renumbered stop_sequence (smoke round 20, R20-T1)', () => {
  const now = epoch(D, '10:35:00')

  it('places each update by stop_id: Central gets its own 10:28, Graceville gets 10:46:38', () => {
    const snap = build(TRIP_ID, replacementStus(), now, { rel: REPLACEMENT })
    const u = updates(snap, KEY)
    expect(u.find((x) => x.seq === 11)).toEqual({ seq: 11, stopId: CENTRAL, dep: epoch(D, '10:28:00') })
    expect(u.find((x) => x.seq === 19)).toEqual({ seq: 19, stopId: GRACEVILLE, dep: epoch(D, '10:46:38') })
    // Nothing lands before the replacement joins the pattern.
    expect(Math.min(...u.map((x) => x.seq))).toBe(9)
    expect(snap.header.stats?.train?.seqMismatch).toBe(1)
    expect(snap.header.stats?.train?.seqDropped).toBeUndefined()
  })

  it('never shows the departed train LIVE at Central', () => {
    const snap = build(TRIP_ID, replacementStus(), now, { rel: REPLACEMENT })
    const rows = board(CENTRAL, snap, now).filter((r) => r.tripInstance === KEY)
    expect(rows.filter((r) => r.status === 'live')).toEqual([])
    expect(rows.some((r) => r.estDep === epoch(D, '10:46:38'))).toBe(false)
    // Graceville still gets the live time the feed gave for it.
    const g = board(GRACEVILLE, snap, now).find((r) => r.tripInstance === KEY)
    expect(g).toMatchObject({ status: 'live', estDep: epoch(D, '10:46:38') })
  })

  it('drops a replacement stop that is not on the static trip instead of landing it on another stop', () => {
    const stus = replacementStus()
    // A stop the static pattern doesn't have, numbered between Central (3) and Roma St (4): the renumbered feed
    // around it can't vouch for its sequence.
    stus.splice(3, 0, { seq: 4, stopId: '699999', depTime: epoch(D, '10:31:00') })
    for (const u of stus.slice(4)) u.seq = (u.seq as number) + 1
    const snap = build(TRIP_ID, stus, now, { rel: REPLACEMENT })
    const u = updates(snap, KEY)
    expect(u.some((x) => x.stopId === '699999')).toBe(false)
    expect(u.find((x) => x.seq === 12)).toMatchObject({ stopId: '600029' })
    expect(snap.header.stats?.train?.seqDropped).toBe(1)
  })

  it('keeps an unindexed platform when the feed numbering around it is the static one', () => {
    // Aligned replacement (seq = static seq), with Central reported on a platform the static data doesn't list.
    const stus: Stu = [
      { seq: 10, stopId: '600010', depTime: epoch(D, '10:20:00') },
      { seq: 11, stopId: '600020', depTime: epoch(D, '10:28:00') },
      { seq: 12, stopId: '600029', depTime: epoch(D, '10:31:00') },
    ]
    const snap = build(TRIP_ID, stus, epoch(D, '10:00:00'), { rel: REPLACEMENT })
    expect(updates(snap, KEY).map((x) => [x.seq, x.stopId])).toEqual([
      [10, '600010'],
      [11, '600020'],
      [12, '600029'],
    ])
    expect(snap.header.stats?.train?.seqMismatch).toBeUndefined()
  })

  it('matches a replacement vehicle by its stop_id, not its renumbered current_stop_sequence', () => {
    const veh = (rel?: number) => ({
      id: 'v',
      vehicle: {
        // No start_date, so tier 1 checks the stop pattern.
        trip: { tripId: TRIP_ID, ...(rel != null ? { scheduleRelationship: rel } : {}) },
        vehicle: { id: 'v' },
        position: { latitude: -27.46, longitude: 153.02 },
        currentStopSequence: 3,
        stopId: CENTRAL,
      },
    })
    const rep = build(TRIP_ID, [], now, { noTu: true, vehicles: [veh(REPLACEMENT)] })
    expect(rep.vehicles[0]).toMatchObject({ tripKey: KEY, stopId: CENTRAL })
    // A SCHEDULED vehicle whose sequence names another stop is still not attached (a conflict, as before).
    const sch = build(TRIP_ID, [], now, { noTu: true, vehicles: [veh()] })
    expect(sch.vehicles[0]?.tripKey).toBeUndefined()
  })
})

describe('stop_sequence resolution for ordinary trips', () => {
  const now = epoch(D, '09:00:00')

  it('leaves SCHEDULED updates whose seq and stop_id agree unchanged', () => {
    const stus: Stu = [
      { seq: 10, stopId: '600010', depDelay: 60 },
      { seq: 11, stopId: CENTRAL, depDelay: 120, rel: SKIPPED },
      { seq: 12, stopId: '600029', depDelay: 120 },
    ]
    const snap = build(TRIP_ID, stus, now)
    expect(snap.trips[KEY]?.updates).toEqual([
      { seq: 10, stopId: '600010', rel: 'SCHEDULED', depDelay: 60 },
      { seq: 11, stopId: CENTRAL, rel: 'SKIPPED' },
      { seq: 12, stopId: '600029', rel: 'SCHEDULED', depDelay: 120 },
    ])
    expect(snap.header.stats?.train?.seqMismatch).toBeUndefined()
    expect(snap.header.stats?.train?.seqDropped).toBeUndefined()
  })

  it('re-places a SCHEDULED trip offset by one stop (bus, 22 Oct feed) by stop_id', () => {
    const stus: Stu = [
      { seq: 10, stopId: '600010', depDelay: 0 },
      // Feed numbering drops static seq 11, so every later seq is one short.
      { seq: 11, stopId: '600029', depDelay: 60 },
      { seq: 12, stopId: '600279', depDelay: 90 },
    ]
    const snap = build(TRIP_ID, stus, now)
    expect(updates(snap, KEY).map((x) => [x.seq, x.stopId])).toEqual([
      [10, '600010'],
      [12, '600029'],
      [13, '600279'],
    ])
    expect(snap.header.stats?.train?.seqMismatch).toBe(1)
  })

  it('resolves a loop that repeats a stop to the right visit', () => {
    const loop = `LOOP@${D}`
    // Agreeing seq on the second visit.
    expect(updates(build('LOOP', [{ seq: 4, stopId: 'A', depDelay: 0 }], now), loop)).toEqual([
      { seq: 4, stopId: 'A', dep: undefined },
    ])
    // Renumbered: C then A means the second visit, never the first.
    const rep = build(
      'LOOP',
      [
        { seq: 1, stopId: 'C', depDelay: 0 },
        { seq: 2, stopId: 'A', depDelay: 0 },
      ],
      now,
      { rel: REPLACEMENT },
    )
    expect(updates(rep, loop).map((x) => x.seq)).toEqual([3, 4])
    // A then B: only the first visit comes before B.
    const ab = build(
      'LOOP',
      [
        { seq: 1, stopId: 'A', depDelay: 0 },
        { seq: 2, stopId: 'B', depDelay: 0 },
      ],
      now,
      { rel: REPLACEMENT },
    )
    expect(updates(ab, loop).map((x) => x.seq)).toEqual([1, 2])
    // A lone renumbered A could be either visit: dropped, never guessed (Codex review r1, finding 3).
    for (const seq of [1, 2, 3]) {
      const lone = build('LOOP', [{ seq, stopId: 'A', depDelay: 300 }], now, { rel: REPLACEMENT })
      expect(updates(lone, loop)).toEqual([])
    }
    // On a SCHEDULED trip a seq that names the same stop still picks the visit.
    expect(updates(build('LOOP', [{ seq: 1, stopId: 'A', depDelay: 0 }], now), loop)[0]?.seq).toBe(1)
    // No seq: the next visit after the last resolved stop.
    const noSeq = build(
      'LOOP',
      [
        { stopId: 'B', depDelay: 0 },
        { stopId: 'A', depDelay: 0 },
      ],
      now,
    )
    expect(updates(noSeq, loop).map((x) => x.seq)).toEqual([2, 4])
  })

  it('uses a seq without a stop_id only where the feed numbering is the static one', () => {
    const between: Stu = [
      { seq: 10, stopId: '600010', depDelay: 0 },
      { seq: 11, depDelay: 30 },
      { seq: 12, stopId: '600029', depDelay: 60 },
    ]
    expect(updates(build(TRIP_ID, between, now), KEY).map((x) => [x.seq, x.stopId])).toEqual([
      [10, '600010'],
      [11, CENTRAL],
      [12, '600029'],
    ])
    // Alone on a SCHEDULED trip: trusted as before.
    expect(updates(build(TRIP_ID, [{ seq: 11, depDelay: 30 }], now), KEY)).toEqual([
      { seq: 11, stopId: CENTRAL, dep: undefined },
    ])
    // Alone on a REPLACEMENT trip, or between renumbered neighbours: dropped.
    const alone = build(TRIP_ID, [{ seq: 11, depDelay: 30 }], now, { rel: REPLACEMENT })
    expect(updates(alone, KEY)).toEqual([])
    expect(alone.header.stats?.train?.seqDropped).toBe(1)
    const renumbered: Stu = [
      { seq: 2, stopId: '600010', depDelay: 0 },
      { seq: 3, depDelay: 30 },
      { seq: 4, stopId: '600029', depDelay: 60 },
    ]
    const r = build(TRIP_ID, renumbered, now, { rel: REPLACEMENT })
    expect(updates(r, KEY).map((x) => x.seq)).toEqual([10, 12])
    // The dropped update leaves a barrier, so seq 10's delay doesn't carry over the stop it spoke about.
    expect(barriers(r, KEY)).toEqual([11])
  })

  it('a dropped update stops an earlier delay propagating over it (Codex review r1, finding 1)', () => {
    const at = epoch(D, '10:13:00')
    // Bowen Hills 10 min late, then Fortitude Valley on an unknown platform whose neighbour gives no seq, so it
    // can't be placed. Without a barrier Central would inherit +10 min and show LIVE after the train had gone.
    for (const rel of [undefined, SKIPPED, 2 /* NO_DATA */]) {
      const stus: Stu = [
        { seq: 9, stopId: '600002', depDelay: 600 },
        { seq: 10, stopId: '600011', depTime: epoch(D, '10:05:00'), rel },
        { stopId: '600029', depDelay: 0 },
      ]
      const snap = build(TRIP_ID, stus, at)
      expect(barriers(snap, KEY)).toEqual([10])
      const row = board(CENTRAL, snap, at).find((r) => r.tripInstance === KEY)
      expect(row?.status).not.toBe('live')
    }
  })

  it("keeps a replacement's origin rule where TransLink numbers it 1 (Codex review r1, finding 2)", () => {
    // Starts at static seq 9 (Bowen Hills): its arrival there is the inbound train, its departure is stated.
    const at = epoch(D, '10:16:00')
    const stus: Stu = [
      { seq: 1, stopId: '600002', arrTime: epoch(D, '10:30:00'), depTime: epoch(D, '10:10:00') },
      { seq: 2, stopId: '600010', arrTime: epoch(D, '10:13:00'), depTime: epoch(D, '10:14:00') },
    ]
    const snap = build(TRIP_ID, stus, at, { rel: REPLACEMENT })
    const origin = snap.trips[KEY]?.updates.find((u) => u.seq === 9)
    expect(origin?.arr).toBeUndefined()
    expect(origin?.dep).toBe(epoch(D, '10:10:00'))
    expect(board('600002', snap, at).filter((r) => r.tripInstance === KEY)).toEqual([])
  })

  it('never puts a stop that is on the trip at another stop (Codex review r1, finding 4)', () => {
    const key = `XYZ@${D}`
    const snap = build(
      'XYZ',
      [
        { seq: 1, stopId: 'X', depDelay: 0 },
        { seq: 2, stopId: 'X', depTime: epoch(D, '10:40:00') },
        { seq: 3, stopId: 'Z', depDelay: 0 },
      ],
      now,
    )
    expect(updates(snap, key).map((x) => [x.seq, x.stopId])).toEqual([
      [1, 'X'],
      [3, 'Z'],
    ])
    expect(barriers(snap, key)).toEqual([2])
    expect(board('Y', snap, epoch(D, '10:05:00')).find((r) => r.tripInstance === key)?.status).not.toBe(
      'live',
    )
  })

  it('matches a REPLACEMENT update without start_date by stop_id', () => {
    const snap = build(TRIP_ID, replacementStus(), epoch(D, '10:35:00'), {
      rel: REPLACEMENT,
      startDate: null,
    })
    expect(snap.trips[KEY]?.tier).toBe(1)
    expect(updates(snap, KEY).find((x) => x.seq === 11)?.stopId).toBe(CENTRAL)
  })

  it('a SKIPPED stop after a dropped update does not hide the barrier (Codex review r2)', () => {
    const key = `XYZ@${D}`
    const at = epoch(D, '10:23:00')
    const snap = build(
      'XYZ',
      [
        { seq: 1, stopId: 'X', depDelay: 600 },
        { seq: 2, stopId: 'UNKNOWN', rel: 2 /* NO_DATA */ },
        { seq: 3, stopId: 'Y', rel: SKIPPED },
      ],
      at,
    )
    expect(updates(snap, key).map((x) => [x.seq, x.stopId])).toEqual([
      [1, 'X'],
      [2, 'Y'],
    ])
    expect(barriers(snap, key)).toEqual([3])
    expect(board('Z', snap, at).find((r) => r.tripInstance === key)?.status).not.toBe('live')
  })
})
