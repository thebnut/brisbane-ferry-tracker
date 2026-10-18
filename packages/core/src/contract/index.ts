/**
 * The /v1 contract (transit-architecture.md §3.2, §3.3, §3.8; ADR-0002, ADR-0003, ADR-0007).
 *
 * Three layers, each versioned by SCHEMA_VERSION:
 *  1. Static stop-day files written by the pipeline (one per stop or station per service day).
 *  2. The realtime snapshot written by the RtHub Durable Object every cycle.
 *  3. The /v1 response envelopes served by the edge Worker.
 *
 * Every schema here is shared by the pipeline, the Worker, the apps, MCP tool schemas and tests.
 */
import { z } from 'zod'

export const SCHEMA_VERSION = 1 as const

export const Mode = z.enum(['ferry', 'train', 'bus', 'tram'])
export type Mode = z.infer<typeof Mode>

/** GTFS service date, YYYYMMDD. A departure at 25:10 belongs to the previous calendar day's service date. */
export const ServiceDate = z.string().regex(/^\d{8}$/)
export type ServiceDate = z.infer<typeof ServiceDate>

/** Trip instance identity: trip_id plus service date (`{tripId}@{serviceDate}`). */
export const TripInstanceKey = z.string().regex(/^.+@\d{8}$/)
export type TripInstanceKey = z.infer<typeof TripInstanceKey>

export const tripInstanceKey = (tripId: string, serviceDate: string): TripInstanceKey =>
  `${tripId}@${serviceDate}`
export const parseTripInstanceKey = (key: string): { tripId: string; serviceDate: string } => {
  const at = key.lastIndexOf('@')
  return { tripId: key.slice(0, at), serviceDate: key.slice(at + 1) }
}

/** GTFS pickup_type / drop_off_type: 0 regular, 1 none, 2 phone agency, 3 coordinate with driver. */
export const BoardingRule = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

// ---------------------------------------------------------------------------
// 1. Static stop-day file (static/blobs/{sha256}.json.br)
// ---------------------------------------------------------------------------

export const RouteRef = z.object({
  id: z.string(),
  short: z.string(),
  long: z.string().optional(),
  color: z
    .string()
    .regex(/^[0-9A-Fa-f]{6}$/)
    .optional(),
  textColor: z
    .string()
    .regex(/^[0-9A-Fa-f]{6}$/)
    .optional(),
})
export type RouteRef = z.infer<typeof RouteRef>

export const StopRef = z.object({
  id: z.string(),
  name: z.string(),
  /** Platform code for rail and busway platforms, if the feed has one. */
  platform: z.string().optional(),
  /** Parent station key (train) or the stop's own key. */
  key: z.string().optional(),
})
export type StopRef = z.infer<typeof StopRef>

/**
 * One stop event, encoded as a positional tuple to keep files small (§3.2):
 *
 *  [tripIdx, stopSequence, arrS, depS, routeIdx, headsignIdx, platformStopIdx, pickupType, directionId, downstream]
 *
 * - `arrS` / `depS`: seconds after the service day's noon-minus-12h reference (GTFS time, can exceed 86400).
 * - `platformStopIdx`: index into `stops`, the boarding stop (the platform, for train stations).
 * - `downstream`: flat list of quadruples `[stopIdx, arrOffsetS, dropOffType, seqDelta]` for every later stop
 *   where alighting is allowed. `arrOffsetS` is downstream arrival minus this event's departure.
 *   `seqDelta` is downstream stop_sequence minus this event's stop_sequence (resolves loops that repeat a stop).
 *
 * Events with pickup_type = 1 (no boarding) are excluded by the builder.
 */
export const StopEventTuple = z.tuple([
  z.number().int().nonnegative(), // tripIdx
  z.number().int().nonnegative(), // stopSequence
  z.number().int().nonnegative(), // arrS
  z.number().int().nonnegative(), // depS
  z.number().int().nonnegative(), // routeIdx
  z.number().int().nonnegative(), // headsignIdx
  z.number().int().nonnegative(), // platformStopIdx
  BoardingRule, // pickupType
  z.union([z.literal(0), z.literal(1), z.literal(-1)]), // directionId (-1 unknown)
  z.array(z.number().int()), // downstream quadruples, flattened
])
export type StopEventTuple = z.infer<typeof StopEventTuple>

export const StaticStopDay = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  mode: Mode,
  /** Stop key: parent station slug for train, stop_id otherwise. */
  stopKey: z.string(),
  serviceDate: ServiceDate,
  trips: z.array(z.string()),
  routes: z.array(RouteRef),
  headsigns: z.array(z.string()),
  stops: z.array(StopRef),
  /** Sorted by depS, then tripIdx. */
  events: z.array(StopEventTuple),
})
export type StaticStopDay = z.infer<typeof StaticStopDay>

/** static/{generation}/{mode}/index.json: maps service date and stop key to a content hash. */
export const GenerationIndex = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generation: z.string(),
  mode: Mode,
  feedVersion: z.string(),
  builtAt: z.string(),
  serviceDates: z.array(ServiceDate),
  /** blobs[serviceDate][stopKey] = sha256 hex of the brotli-compressed blob content. */
  blobs: z.record(ServiceDate, z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/))),
  /** Per service date trip index for the RT hub: static/{generation}/{mode}/trips-{date}.json */
  tripIndex: z.record(ServiceDate, z.string().regex(/^[0-9a-f]{64}$/)).optional(),
})
export type GenerationIndex = z.infer<typeof GenerationIndex>

/** manifest.json, written last so the generation switch is atomic. */
export const Manifest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: z.string(),
  /** modes[mode] = { current, previous } generations. */
  modes: z.partialRecord(
    Mode,
    z.object({
      current: z.string(),
      previous: z.string().optional(),
      serviceDates: z.array(ServiceDate),
    }),
  ),
  quarantined: z
    .array(z.object({ generation: z.string(), mode: Mode, reasons: z.array(z.string()) }))
    .default([]),
})
export type Manifest = z.infer<typeof Manifest>

/**
 * Trip index for one service day (used by the RT hub for matching and by trip detail).
 * Columnar so the hub can hold two days in typed arrays.
 */
export const TripIndexDay = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  mode: Mode,
  serviceDate: ServiceDate,
  generation: z.string(),
  routes: z.array(RouteRef),
  stops: z.array(z.string()),
  trips: z.array(
    z.object({
      id: z.string(),
      r: z.number().int(), // route index
      d: z.union([z.literal(0), z.literal(1), z.literal(-1)]),
      h: z.string(), // headsign
      /** Flat [stopIdx, stopSequence, arrS, depS, pickup, dropOff] sextuples in sequence order. */
      st: z.array(z.number().int()),
    }),
  ),
})
export type TripIndexDay = z.infer<typeof TripIndexDay>

// ---------------------------------------------------------------------------
// 2. Realtime snapshot (rt/snapshot-{seq}.json.br) and the stop-event state machine
// ---------------------------------------------------------------------------

/** GTFS-RT StopTimeUpdate.ScheduleRelationship */
export const StopRel = z.enum(['SCHEDULED', 'SKIPPED', 'NO_DATA'])
/** GTFS-RT TripDescriptor.ScheduleRelationship */
export const TripRel = z.enum(['SCHEDULED', 'CANCELED', 'ADDED', 'DUPLICATED', 'REPLACEMENT', 'DELETED'])
export type TripRel = z.infer<typeof TripRel>

/**
 * One explicit stop-time update as received. Predictions are absolute epoch seconds when the feed gave a time,
 * otherwise derived from delay + scheduled time by the hub. `u` = uncertainty seconds if given.
 */
export const RtStopUpdate = z.object({
  seq: z.number().int(),
  stopId: z.string().optional(),
  rel: StopRel,
  arr: z.number().int().optional(),
  arrDelay: z.number().int().optional(),
  dep: z.number().int().optional(),
  depDelay: z.number().int().optional(),
  u: z.number().int().optional(),
})
export type RtStopUpdate = z.infer<typeof RtStopUpdate>

export const MatchTier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

export const RtTrip = z.object({
  /** Matched trip instance, or for ADDED trips a synthetic key `rt:{tripId}@{date}`. */
  key: z.string(),
  rel: TripRel,
  tier: MatchTier.optional(),
  /** Feed entity timestamp (epoch s) or header timestamp if absent. */
  ts: z.number().int(),
  /** When a CANCELED record expires (scheduled end of the trip, epoch s). */
  until: z.number().int().optional(),
  vehicleId: z.string().optional(),
  updates: z.array(RtStopUpdate),
})
export type RtTrip = z.infer<typeof RtTrip>

export const Vehicle = z.object({
  id: z.string(),
  label: z.string().optional(),
  tripKey: z.string().optional(),
  routeId: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  bearing: z.number().optional(),
  speed: z.number().optional(),
  occupancy: z.string().optional(),
  status: z.string().optional(),
  stopId: z.string().optional(),
  ts: z.number().int(),
})
export type Vehicle = z.infer<typeof Vehicle>

export const Alert = z.object({
  id: z.string(),
  header: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
  cause: z.string().optional(),
  effect: z.string().optional(),
  severity: z.string().optional(),
  activePeriods: z.array(z.object({ start: z.number().int().optional(), end: z.number().int().optional() })),
  routes: z.array(z.string()),
  stops: z.array(z.string()),
  modes: z.array(Mode),
  summary: z.string().optional(),
})
export type Alert = z.infer<typeof Alert>

export const MatchStats = z.object({
  total: z.number().int(),
  matched: z.number().int(),
  ambiguous: z.number().int(),
  unmatched: z.number().int(),
  byTier: z.record(z.string(), z.number().int()),
  addedDropped: z.number().int(),
})
export type MatchStats = z.infer<typeof MatchStats>

export const RtSnapshotHeader = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  seq: z.number().int(),
  /** staticGeneration per mode that the trip index was built from. */
  staticGeneration: z.partialRecord(Mode, z.string()),
  serviceDates: z.array(ServiceDate),
  /** TransLink FeedHeader.timestamp, epoch s. */
  sourceTimestamp: z.number().int(),
  /** When the hub fetched the feed, epoch ms. */
  fetchedAt: z.number().int(),
  stats: z.partialRecord(Mode, MatchStats).optional(),
})
export type RtSnapshotHeader = z.infer<typeof RtSnapshotHeader>

export const RtSnapshot = z.object({
  header: RtSnapshotHeader,
  /** trips[tripInstanceKey] */
  trips: z.record(z.string(), RtTrip),
  vehicles: z.array(Vehicle),
  alerts: z.array(Alert),
})
export type RtSnapshot = z.infer<typeof RtSnapshot>

// ---------------------------------------------------------------------------
// 3. /v1 responses
// ---------------------------------------------------------------------------

/** live: fresh RT. stale: RT older than 5 min. reloading: generations differ. unavailable: no RT at all. */
export const RtState = z.enum(['live', 'stale', 'reloading', 'unavailable'])
export type RtState = z.infer<typeof RtState>

export const DepartureStatus = z.enum(['scheduled', 'live', 'skipped', 'cancelled', 'unknown'])
export type DepartureStatus = z.infer<typeof DepartureStatus>

export const Envelope = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  staticGeneration: z.string().nullable(),
  serviceDates: z.array(ServiceDate),
  /** Epoch s of the TransLink header behind any live data, or null. */
  rtSourceTimestamp: z.number().int().nullable(),
  rtState: RtState,
  /** Server time the response was computed, epoch ms. */
  generatedAt: z.number().int(),
})
export type Envelope = z.infer<typeof Envelope>

export const Departure = z.object({
  tripInstance: TripInstanceKey,
  stopSequence: z.number().int(),
  route: RouteRef,
  headsign: z.string(),
  directionId: z.number().int(),
  /** Boarding stop id and platform code (train), if known. */
  stopId: z.string(),
  platform: z.string().nullable(),
  /** Epoch seconds. */
  schedDep: z.number().int(),
  estDep: z.number().int().nullable(),
  schedArrTo: z.number().int().nullable(),
  estArrTo: z.number().int().nullable(),
  status: DepartureStatus,
  /** True when a vehicle position for this trip is known. */
  gps: z.boolean(),
  vehicleId: z.string().nullable(),
  /** Downstream stop ids where this service lets you off, in order (for stopping patterns). */
  stopsAfter: z.array(z.string()).optional(),
})
export type Departure = z.infer<typeof Departure>

export const DeparturesResponse = Envelope.extend({
  mode: Mode,
  stop: z.object({ key: z.string(), name: z.string(), stopIds: z.array(z.string()) }),
  to: z.object({ key: z.string(), name: z.string() }).nullable(),
  departures: z.array(Departure),
})
export type DeparturesResponse = z.infer<typeof DeparturesResponse>

export const TripStop = z.object({
  stopId: z.string(),
  name: z.string().optional(),
  stopSequence: z.number().int(),
  schedArr: z.number().int().nullable(),
  schedDep: z.number().int().nullable(),
  estArr: z.number().int().nullable(),
  estDep: z.number().int().nullable(),
  status: DepartureStatus,
  pickup: BoardingRule,
  dropOff: BoardingRule,
})
export type TripStop = z.infer<typeof TripStop>

export const TripResponse = Envelope.extend({
  mode: Mode,
  tripInstance: TripInstanceKey,
  route: RouteRef,
  headsign: z.string(),
  status: DepartureStatus,
  vehicle: Vehicle.nullable(),
  stops: z.array(TripStop),
})
export type TripResponse = z.infer<typeof TripResponse>

export const VehiclesResponse = Envelope.extend({ mode: Mode, vehicles: z.array(Vehicle) })
export type VehiclesResponse = z.infer<typeof VehiclesResponse>

export const AlertsResponse = Envelope.extend({ alerts: z.array(Alert) })
export type AlertsResponse = z.infer<typeof AlertsResponse>

export const HealthResponse = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  ok: z.boolean(),
  now: z.number().int(),
  manifest: z.object({ updatedAt: z.string().nullable(), generations: z.record(z.string(), z.string()) }),
  rt: z.object({
    seq: z.number().int().nullable(),
    sourceTimestamp: z.number().int().nullable(),
    fetchedAt: z.number().int().nullable(),
    ageS: z.number().nullable(),
    lastError: z.string().nullable(),
    stats: z.record(z.string(), MatchStats).nullable(),
  }),
  ai: z.object({ enabled: z.boolean(), budgetUsedUsd: z.number().nullable() }),
})
export type HealthResponse = z.infer<typeof HealthResponse>

export const ErrorResponse = z.object({ error: z.string(), detail: z.string().optional() })
