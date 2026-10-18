/**
 * Build one RtSnapshot from decoded GTFS-RT feeds (transit-architecture.md §3.3, ADR-0003).
 *
 * Pure apart from the inputs, so the Durable Object, the Phase 0 CPU spike and the tests all run the same code.
 * - Matches TripUpdates to trip instances with the tiered TripMatcher from @bft/core (ambiguous stays unmatched).
 * - Normalises absolute stop times to delays against the matched static trip.
 * - Applies the state machine's record rules: cancellations persist until their scheduled end; ADDED / DUPLICATED
 *   trips are kept only when every stop resolves to a known static stop with a usable time, else counted and dropped.
 */
import {
  type Alert,
  gtfsToEpoch,
  isRecordLive,
  type MatchStats,
  type Mode,
  type RouteRef,
  type RtDescriptor,
  type RtSnapshot,
  type RtStopObservation,
  type RtStopUpdate,
  type RtTrip,
  routeKey,
  SCHEMA_VERSION,
  type TripIndexDay,
  TripMatcher,
  type TripRel,
  tripInstanceKey,
  type Vehicle,
} from '@bft/core'
import {
  Alert_Cause,
  Alert_Effect,
  Alert_SeverityLevel,
  type FeedMessage,
  type Alert as PbAlert,
  TripUpdate_StopTimeUpdate_ScheduleRelationship as PbStopRel,
  TripDescriptor_ScheduleRelationship as PbTripRel,
  type TranslatedString,
  type TripDescriptor,
  type TripUpdate,
  type TripUpdate_StopTimeEvent,
  type TripUpdate_StopTimeUpdate,
  VehiclePosition_OccupancyStatus,
  VehiclePosition_VehicleStopStatus,
} from '../gen/gtfs-realtime_pb.js'
import { modeForRouteType } from './feeds.ts'

type IndexedTrip = NonNullable<ReturnType<TripMatcher['trip']>>

/** proto2 presence: protobuf-es keeps defaults on the prototype, so a set field is an own property. */
const has = (o: object | undefined, k: string): boolean => o != null && Object.hasOwn(o, k)
const num = (v: bigint | number): number => Number(v)

/** Everything the hub knows about one mode's static data: matcher plus lookups for ADDED trips. */
export class ModeIndex {
  readonly matcher: TripMatcher
  readonly routes = new Map<string, RouteRef>()
  readonly routesByKey = new Map<string, RouteRef>()
  readonly stopIds = new Set<string>()
  /** headsign and route per trip instance (DUPLICATED trips copy them from the original). */
  readonly tripMeta = new Map<string, { h: string; r: RouteRef | undefined }>()
  generation: string
  readonly serviceDates: string[] = []

  constructor(
    readonly mode: Mode,
    days: TripIndexDay[],
  ) {
    this.matcher = new TripMatcher(mode, [])
    this.generation = days[0]?.generation ?? ''
    for (const day of days) this.addDay(day)
  }

  /** Index one more service day (the hub adds one per alarm cycle to stay inside the CPU budget). */
  addDay(day: TripIndexDay): void {
    this.generation ||= day.generation
    this.serviceDates.push(day.serviceDate)
    this.matcher.addDay(day)
    for (const r of day.routes) {
      this.routes.set(r.id, r)
      this.routesByKey.set(routeKey(r.id), r)
    }
    for (const s of day.stops) this.stopIds.add(s)
    for (const t of day.trips)
      this.tripMeta.set(tripInstanceKey(t.id, day.serviceDate), { h: t.h, r: day.routes[t.r] })
  }

  route(routeId: string | undefined): RouteRef | undefined {
    if (!routeId) return undefined
    return this.routes.get(routeId) ?? this.routesByKey.get(routeKey(routeId))
  }
}

export interface BuildInput {
  seq: number
  nowMs: number
  /** Loaded static data per polled mode. A mode without an index is published without trip matches. */
  indexes: Partial<Record<Mode, ModeIndex>>
  /** TripUpdates feeds: per-mode feeds carry their mode, a combined feed has none. */
  tripUpdates: Array<{ mode?: Mode; feed: FeedMessage }>
  vehiclePositions: Array<{ mode?: Mode; feed: FeedMessage }>
  /** Pre-built alerts (alerts refresh every 60 s, not every cycle). */
  alerts: Alert[]
  previous?: RtSnapshot | null
  /**
   * Indexed modes whose trip indexes haven't loaded yet (after a restart). Live cancellations from `previous` that
   * no loaded index can check are retained while any mode is still unloaded.
   */
  unloadedModes?: Mode[]
}

const emptyStats = (): MatchStats => ({
  total: 0,
  matched: 0,
  ambiguous: 0,
  unmatched: 0,
  byTier: {},
  addedDropped: 0,
})

function tripRel(r: PbTripRel | undefined): TripRel {
  switch (r) {
    case PbTripRel.CANCELED:
      return 'CANCELED'
    case PbTripRel.DELETED:
      return 'DELETED'
    case PbTripRel.ADDED:
    case PbTripRel.NEW:
    case PbTripRel.UNSCHEDULED:
      return 'ADDED'
    case PbTripRel.DUPLICATED:
      return 'DUPLICATED'
    case PbTripRel.REPLACEMENT:
      return 'REPLACEMENT'
    default:
      return 'SCHEDULED'
  }
}

function descriptor(d: TripDescriptor | undefined): RtDescriptor {
  if (!d) return {}
  return {
    tripId: d.tripId || undefined,
    startDate: d.startDate || undefined,
    startTime: d.startTime || undefined,
    routeId: d.routeId || undefined,
    directionId: has(d, 'directionId') ? d.directionId : undefined,
  }
}

const evTime = (e: TripUpdate_StopTimeEvent | undefined): number | undefined =>
  e && has(e, 'time') && e.time !== 0n ? num(e.time) : undefined
const evDelay = (e: TripUpdate_StopTimeEvent | undefined): number | undefined =>
  e && has(e, 'delay') ? e.delay : undefined

function observations(stus: TripUpdate_StopTimeUpdate[]): RtStopObservation[] {
  return stus.map((u) => ({
    seq: has(u, 'stopSequence') ? u.stopSequence : undefined,
    stopId: u.stopId || undefined,
    arr: evTime(u.arrival),
    dep: evTime(u.departure),
  }))
}

/** The next stop_sequence after `after` at which the static trip visits `stopId` (loops repeat stops). */
function seqForStop(trip: IndexedTrip, stopId: string, after: number): number | undefined {
  for (const [seq, st] of trip.stops) if (seq > after && st.stopId === stopId) return seq
  return undefined
}

function stopRel(r: PbStopRel): RtStopUpdate['rel'] {
  if (r === PbStopRel.SKIPPED) return 'SKIPPED'
  if (r === PbStopRel.NO_DATA || r === PbStopRel.UNSCHEDULED) return 'NO_DATA'
  return 'SCHEDULED'
}

/** Normalise stop-time updates against the matched static trip: resolve seq, derive delays from absolute times. */
export function normaliseUpdates(stus: TripUpdate_StopTimeUpdate[], trip: IndexedTrip): RtStopUpdate[] {
  const out: RtStopUpdate[] = []
  let last = Number.NEGATIVE_INFINITY
  for (const u of stus) {
    const seq = has(u, 'stopSequence')
      ? u.stopSequence
      : u.stopId
        ? seqForStop(trip, u.stopId, last)
        : undefined
    if (seq == null) continue
    last = seq
    const st = trip.stops.get(seq)
    const rec: RtStopUpdate = { seq, rel: stopRel(u.scheduleRelationship) }
    const sid = u.stopId || st?.stopId
    if (sid) rec.stopId = sid
    if (rec.rel === 'SCHEDULED') {
      const arr = evTime(u.arrival)
      const dep = evTime(u.departure)
      const arrDelay = evDelay(u.arrival) ?? (arr != null && st ? arr - st.arrEpoch : undefined)
      const depDelay = evDelay(u.departure) ?? (dep != null && st ? dep - st.depEpoch : undefined)
      if (arr != null) rec.arr = arr
      if (arrDelay != null) rec.arrDelay = arrDelay
      if (dep != null) rec.dep = dep
      if (depDelay != null) rec.depDelay = depDelay
      const unc = u.arrival?.uncertainty || u.departure?.uncertainty
      if (unc) rec.u = unc
    }
    out.push(rec)
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/**
 * ADDED / DUPLICATED trips: every stop must be a known static stop with an absolute time (or, for DUPLICATED, a
 * delay applied to the original trip shifted to the new start time). Returns null when the stop list doesn't resolve.
 */
function resolveAdded(
  tu: TripUpdate,
  rel: TripRel,
  idx: ModeIndex,
  desc: RtDescriptor,
): { key: string; added: NonNullable<RtTrip['added']> } | null {
  const stus = tu.stopTimeUpdate
  if (stus.length === 0) return null
  let original: IndexedTrip | undefined
  let originalKey: string | undefined
  let shift = 0
  // DUPLICATED (GTFS-RT spec): the descriptor names the original trip; the duplicate's own trip_id, start_date and
  // start_time are in TripProperties. The duplicate's schedule is the original's, shifted to the new start.
  const props = tu.tripProperties
  const dup =
    rel === 'DUPLICATED'
      ? {
          tripId: props?.tripId || undefined,
          startDate: props?.startDate || desc.startDate,
          startTime: props?.startTime || desc.startTime,
        }
      : null
  if (dup && desc.tripId) {
    const m = idx.matcher.match(
      { tripId: desc.tripId, startDate: desc.startDate, startTime: desc.startTime },
      [],
    )
    if (m.kind === 'matched') {
      originalKey = m.key
      original = idx.matcher.trip(m.key)
      const newStart = parseStart(dup.startTime)
      const first = original ? [...original.stops.values()][0] : undefined
      if (original && first && newStart != null && dup.startDate) {
        shift = gtfsToEpoch(dup.startDate, newStart) - first.depEpoch
      }
    }
  }
  const stops: NonNullable<RtTrip['added']>['stops'] = []
  for (const u of stus) {
    if (u.scheduleRelationship === PbStopRel.SKIPPED) continue
    const stopId =
      u.stopId || (original && has(u, 'stopSequence') ? original.stops.get(u.stopSequence)?.stopId : '')
    if (!stopId || !idx.stopIds.has(stopId)) return null
    let arr = evTime(u.arrival)
    let dep = evTime(u.departure)
    if ((arr == null || dep == null) && original && has(u, 'stopSequence')) {
      const st = original.stops.get(u.stopSequence)
      if (st) {
        arr ??= st.arrEpoch + shift + (evDelay(u.arrival) ?? evDelay(u.departure) ?? 0)
        dep ??= st.depEpoch + shift + (evDelay(u.departure) ?? evDelay(u.arrival) ?? 0)
      }
    }
    arr ??= dep
    dep ??= arr
    if (arr == null || dep == null) return null
    stops.push({
      stopId,
      seq: has(u, 'stopSequence') ? u.stopSequence : stops.length + 1,
      arr,
      dep: Math.max(arr, dep),
    })
  }
  if (stops.length < 2) return null
  const meta = originalKey ? idx.tripMeta.get(originalKey) : undefined
  const route = idx.route(desc.routeId) ?? meta?.r
  if (!route) return null
  const date = (dup ? dup.startDate : desc.startDate) ?? originalKey?.slice(-8)
  if (!date || !/^\d{8}$/.test(date)) return null
  const headsign = (tu.tripProperties?.tripHeadsign || meta?.h) ?? ''
  const dir = desc.directionId === 0 || desc.directionId === 1 ? desc.directionId : -1
  return {
    key: dup
      ? `rt:${dup.tripId ?? `${desc.tripId}+${dup.startTime ?? ''}`}@${date}`
      : `rt:${desc.tripId ?? tu.vehicle?.id ?? 'added'}@${date}`,
    added: { route, headsign, directionId: dir, stops },
  }
}

const parseStart = (t: string | undefined): number | null => {
  const m = t ? /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t) : null
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

function modeOf(
  feedMode: Mode | undefined,
  routeId: string | undefined,
  byRoute: Map<string, Mode>,
  fallback: Mode[],
): { modes: Mode[]; known: boolean } {
  if (feedMode) return { modes: [feedMode], known: true }
  const m = routeId ? byRoute.get(routeKey(routeId)) : undefined
  return m ? { modes: [m], known: true } : { modes: fallback, known: false }
}

export interface BuildResult {
  snapshot: RtSnapshot
  /** tripId|startDate → matched key, reused for vehicle positions. */
  keyByDescriptor: Map<string, string>
}

export function buildSnapshot(input: BuildInput): BuildResult {
  const nowS = Math.floor(input.nowMs / 1000)
  const modes = Object.keys(input.indexes) as Mode[]
  const byRoute = new Map<string, Mode>()
  for (const m of modes) for (const k of input.indexes[m]?.routesByKey.keys() ?? []) byRoute.set(k, m)

  const stats: Partial<Record<Mode, MatchStats>> = {}
  for (const m of modes) stats[m] = emptyStats()
  const trips: Record<string, RtTrip> = {}
  const keyByDescriptor = new Map<string, string>()
  let sourceTimestamp = Number.POSITIVE_INFINITY

  for (const { mode: feedMode, feed } of input.tripUpdates) {
    const headerTs = feed.header ? num(feed.header.timestamp) : 0
    if (headerTs > 0) sourceTimestamp = Math.min(sourceTimestamp, headerTs)
    for (const ent of feed.entity) {
      const tu = ent.tripUpdate
      if (!tu || ent.isDeleted) continue
      const desc = descriptor(tu.trip)
      const rel = tripRel(tu.trip?.scheduleRelationship)
      const ts = has(tu, 'timestamp') && tu.timestamp > 0n ? num(tu.timestamp) : headerTs
      const { modes: candidates, known } = modeOf(feedMode, desc.routeId, byRoute, modes)

      if (rel === 'ADDED' || rel === 'DUPLICATED') {
        let done = false
        for (const m of candidates) {
          const idx = input.indexes[m]
          if (!idx) continue
          const r = resolveAdded(tu, rel, idx, desc)
          if (!r) continue
          const st = stats[m] as MatchStats
          st.total++
          st.byTier.added = (st.byTier.added ?? 0) + 1
          trips[r.key] = { key: r.key, rel, ts, updates: [], added: r.added, ...vehicleId(tu) }
          // Vehicles name the duplicate by its own TripProperties identity, not the original's (Codex re-review #2).
          const props = tu.tripProperties
          const vehicleKey =
            rel === 'DUPLICATED'
              ? props?.tripId
                ? `${props.tripId}|${props.startDate || desc.startDate || ''}`
                : null
              : desc.tripId
                ? `${desc.tripId}|${desc.startDate ?? ''}`
                : null
          if (vehicleKey) keyByDescriptor.set(vehicleKey, r.key)
          done = true
          break
        }
        if (!done && known) {
          // Only count against a mode we know the entity belongs to (a combined feed carries unloaded modes too).
          const st = stats[candidates[0] as Mode]
          if (st) {
            st.total++
            st.addedDropped++
          }
        }
        continue
      }

      const obs = observations(tu.stopTimeUpdate)
      let counted = false
      for (const m of candidates) {
        const idx = input.indexes[m]
        if (!idx) continue
        const res = idx.matcher.match(desc, obs)
        if (res.kind === 'unmatched' && (candidates.length > 1 || !known)) continue
        const st = stats[m] as MatchStats
        st.total++
        counted = true
        if (res.kind === 'ambiguous') {
          st.ambiguous++
          break
        }
        if (res.kind === 'unmatched') {
          st.unmatched++
          break
        }
        st.matched++
        st.byTier[String(res.tier)] = (st.byTier[String(res.tier)] ?? 0) + 1
        const it = idx.matcher.trip(res.key) as IndexedTrip
        const rec: RtTrip = {
          key: res.key,
          rel,
          tier: res.tier,
          ts,
          updates: rel === 'CANCELED' || rel === 'DELETED' ? [] : normaliseUpdates(tu.stopTimeUpdate, it),
          ...vehicleId(tu),
        }
        if (rel === 'CANCELED' || rel === 'DELETED') {
          rec.until = it.endEpoch
          rec.gen = idx.generation
        }
        trips[res.key] = rec
        if (desc.tripId) keyByDescriptor.set(`${desc.tripId}|${desc.startDate ?? ''}`, res.key)
        break
      }
      if (!counted && known) {
        const st = stats[candidates[0] as Mode]
        if (st) {
          st.total++
          st.unmatched++
        }
      }
    }
  }

  // Cancellations persist until their scheduled end, even when the feed drops them.
  // Carry a cancellation forward (Codex reviews #4, re-review #1): if a loaded index has the trip, only when the
  // record was matched against that same generation (a reused trip_id in a new feed must not inherit it). If no
  // loaded index has it but some indexed mode is still loading, keep it until that mode can check it.
  for (const prev of Object.values(input.previous?.trips ?? {})) {
    if (trips[prev.key]) continue
    if (!isRecordLive(prev, nowS, false)) continue
    const owner = modes.find((m) => input.indexes[m]?.matcher.trip(prev.key) != null)
    if (owner) {
      const gen = prev.gen ?? input.previous?.header.staticGeneration[owner]
      if (gen !== input.indexes[owner]?.generation) continue
    } else if (!(input.unloadedModes?.length ?? 0)) {
      continue
    }
    trips[prev.key] = prev
  }

  const vehicles: Vehicle[] = []
  for (const { mode: feedMode, feed } of input.vehiclePositions) {
    const headerTs = feed.header ? num(feed.header.timestamp) : 0
    for (const ent of feed.entity) {
      const vp = ent.vehicle
      if (!vp?.position || ent.isDeleted) continue
      const desc = descriptor(vp.trip)
      let tripKey: string | undefined
      if (desc.tripId) tripKey = keyByDescriptor.get(`${desc.tripId}|${desc.startDate ?? ''}`)
      if (!tripKey && (desc.tripId || desc.routeId)) {
        const obs: RtStopObservation[] =
          has(vp, 'currentStopSequence') || vp.stopId
            ? [
                {
                  seq: has(vp, 'currentStopSequence') ? vp.currentStopSequence : undefined,
                  stopId: vp.stopId || undefined,
                },
              ]
            : []
        for (const m of modeOf(feedMode, desc.routeId, byRoute, modes).modes) {
          const res = input.indexes[m]?.matcher.match(desc, obs)
          if (res?.kind === 'matched') {
            tripKey = res.key
            break
          }
        }
      }
      // Fall back to the matched static trip's route when the descriptor omits route_id.
      const routeId = desc.routeId ?? (tripKey ? tripRouteId(input.indexes, tripKey) : undefined)
      const vMode = feedMode ?? (routeId ? byRoute.get(routeKey(routeId)) : undefined)
      const v: Vehicle = {
        id: vp.vehicle?.id || ent.id,
        ...(vMode ? { mode: vMode } : {}),
        lat: vp.position.latitude,
        lon: vp.position.longitude,
        ts: has(vp, 'timestamp') && vp.timestamp > 0n ? num(vp.timestamp) : headerTs,
      }
      if (vp.vehicle?.label) v.label = vp.vehicle.label
      if (tripKey) v.tripKey = tripKey
      if (routeId) v.routeId = routeId
      if (has(vp.position, 'bearing')) v.bearing = vp.position.bearing
      if (has(vp.position, 'speed')) v.speed = vp.position.speed
      if (has(vp, 'occupancyStatus')) v.occupancy = VehiclePosition_OccupancyStatus[vp.occupancyStatus]
      if (has(vp, 'currentStatus')) v.status = VehiclePosition_VehicleStopStatus[vp.currentStatus]
      if (vp.stopId) v.stopId = vp.stopId
      vehicles.push(v)
    }
  }

  const staticGeneration: Partial<Record<Mode, string>> = {}
  const serviceDates = new Set<string>()
  for (const m of modes) {
    const idx = input.indexes[m]
    if (!idx) continue
    staticGeneration[m] = idx.generation
    for (const d of idx.serviceDates) serviceDates.add(d)
  }

  return {
    keyByDescriptor,
    snapshot: {
      header: {
        schemaVersion: SCHEMA_VERSION,
        seq: input.seq,
        staticGeneration,
        serviceDates: [...serviceDates].sort(),
        sourceTimestamp: Number.isFinite(sourceTimestamp) ? sourceTimestamp : nowS,
        fetchedAt: input.nowMs,
        stats,
      },
      trips,
      vehicles,
      alerts: input.alerts,
    },
  }
}

function tripRouteId(indexes: BuildInput['indexes'], key: string): string | undefined {
  for (const idx of Object.values(indexes)) {
    const t = idx?.matcher.trip(key)
    if (t) return t.routeId
  }
  return undefined
}

const vehicleId = (tu: TripUpdate): { vehicleId?: string } =>
  tu.vehicle?.id ? { vehicleId: tu.vehicle.id } : {}

function text(t: TranslatedString | undefined): string | undefined {
  if (!t || t.translation.length === 0) return undefined
  const en = t.translation.find((x) => !x.language || x.language.toLowerCase().startsWith('en'))
  return (en ?? t.translation[0])?.text || undefined
}

/**
 * Alerts feed → contract Alerts. Modes come from the informed entities' route_type, or the mode of a known route or
 * stop. An alert naming only routes/stops of modes we don't load gets no modes, so it is never mistaken for a
 * network-wide notice (those name no route and no stop).
 */
export function buildAlerts(
  feed: FeedMessage,
  routeModes: Map<string, Mode> = new Map(),
  stopModes: Map<string, Mode> = new Map(),
): Alert[] {
  const out: Alert[] = []
  for (const ent of feed.entity) {
    const a: PbAlert | undefined = ent.alert
    if (!a || ent.isDeleted) continue
    const routes = new Set<string>()
    const stops = new Set<string>()
    const modes = new Set<Mode>()
    for (const ie of a.informedEntity) {
      if (ie.routeId) {
        routes.add(ie.routeId)
        const m = routeModes.get(routeKey(ie.routeId))
        if (m) modes.add(m)
      }
      if (ie.stopId) {
        stops.add(ie.stopId)
        const m = stopModes.get(ie.stopId)
        if (m) modes.add(m)
      }
      if (has(ie, 'routeType')) {
        const m = modeForRouteType(ie.routeType)
        if (m) modes.add(m)
      }
    }
    const rec: Alert = {
      id: ent.id,
      header: text(a.headerText) ?? '',
      activePeriods: a.activePeriod.map((p) => {
        const r: { start?: number; end?: number } = {}
        if (has(p, 'start') && p.start > 0n) r.start = num(p.start)
        if (has(p, 'end') && p.end > 0n) r.end = num(p.end)
        return r
      }),
      routes: [...routes],
      stops: [...stops],
      modes: [...modes],
    }
    const desc = text(a.descriptionText)
    if (desc) rec.description = desc
    const url = text(a.url)
    if (url) rec.url = url
    if (has(a, 'cause')) rec.cause = Alert_Cause[a.cause]
    if (has(a, 'effect')) rec.effect = Alert_Effect[a.effect]
    if (has(a, 'severityLevel')) rec.severity = Alert_SeverityLevel[a.severityLevel]
    out.push(rec)
  }
  return out
}
