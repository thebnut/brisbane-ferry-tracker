/**
 * The /v1 API (transit-architecture.md §3.8) plus the Phase 2 legacy compatibility routes.
 * Built from injected dependencies so tests run it in Node against a memory data source and a real HubCore.
 */
import {
  type AlertsResponse,
  addDays,
  currentServiceDate,
  type Departure,
  type DeparturesResponse,
  gtfsToEpoch,
  type HealthResponse,
  type MergeOptions,
  Mode,
  mergeDepartures,
  overlappingServiceDates,
  parseTripInstanceKey,
  predictStop,
  type RtState,
  routeKey,
  rtStateFor,
  SCHEMA_VERSION,
  type StaticStopDay,
  type TripIndexDay,
  type TripResponse,
  type TripStop,
  type VehiclesResponse,
} from '@bft/core'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { corsHeaders } from './cors.ts'
import { mayHaveStop, type StaticStore } from './data/static-store.ts'
import { createLogger, errorMessage, type Logger } from './log.ts'
import { FEED_MODE_SUFFIX, MODES } from './rt/feeds.ts'
import type { SnapshotScope } from './rt/split.ts'
import type { SnapshotClient } from './snapshot-client.ts'
import { type Stations, stationsFor, tripStopPlatform } from './stations.ts'

export interface AppDeps {
  store: StaticStore
  snapshots: SnapshotClient
  /**
   * Per-scope snapshot clients (per-mode split, §3.3): /v1/{mode} reads only its mode's document, /v1/alerts and
   * /v1/health the alerts one. Without it every route uses `snapshots` (the whole snapshot).
   */
  snapshotsFor?: (scope: SnapshotScope) => SnapshotClient
  corsAllowAll?: boolean
  now?: () => number
  log?: Logger
  /** Polled feed layout, so the legacy proxy knows whether to serve a combined or merged per-mode feed. */
  combinedFeeds: boolean
  polledModes: Mode[]
  /** AI kill switch and month-to-date spend for /v1/health (wired in index.ts from env + the Budget DO). */
  aiStatus?: () => Promise<{ enabled: boolean; budgetUsedUsd: number | null }>
}

type Env = { Variables: { rid: string; log: Logger } }

const DEFAULT_LIMIT = 20
/** `at` within this of now is treated as a live query for caching. */
const AT_LIVE_WINDOW_MS = 2 * 60_000
const MAX_LIMIT = 100
/** bbox queries snap outward to this grid (degrees) so cache keys stay bounded. */
export const BBOX_GRID = 0.05

export function createApp(deps: AppDeps): Hono<Env> {
  const app = new Hono<Env>()
  const now = deps.now ?? Date.now
  const baseLog = deps.log ?? createLogger({ svc: 'bft-api' })

  // Request id, structured access log, CORS (legacy parity) on every response.
  app.use('*', async (c, next) => {
    const rid = c.req.header('cf-ray') ?? crypto.randomUUID()
    const log = baseLog.child({ rid })
    c.set('rid', rid)
    c.set('log', log)
    const t0 = now()
    const cors = corsHeaders(c.req.header('origin'), deps.corsAllowAll ?? false, log, c.req.path)
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: { ...cors, 'x-request-id': rid } })
    }
    await next()
    for (const [k, v] of Object.entries(cors)) c.res.headers.set(k, v)
    c.res.headers.set('x-request-id', rid)
    log.info('request', { method: c.req.method, path: c.req.path, status: c.res.status, ms: now() - t0 })
  })

  app.onError((err, c) => {
    c.get('log')?.error('unhandled', { error: errorMessage(err) })
    return c.json({ error: 'internal error' }, 500, { 'cache-control': 'no-store' })
  })
  app.notFound((c) => c.json({ error: 'not found' }, 404))

  const parseMode = (c: Context<Env>): Mode | null => {
    const r = Mode.safeParse(c.req.param('mode'))
    return r.success ? r.data : null
  }

  /** Snapshot plus the rtState for one mode's static generation. */
  async function rt(c: Context<Env>, mode: Mode | null, generation: string | null) {
    const client = deps.snapshotsFor?.(mode ?? 'alerts') ?? deps.snapshots
    const cur = await client.get(waitUntilOf(c))
    const nowMs = now()
    const snap = cur?.snapshot ?? null
    const hubGen = mode == null ? undefined : snap?.header.staticGeneration[mode]
    const genOk = mode == null || (generation != null && hubGen === generation)
    // A mode the hub doesn't index at all (bus, see RT_INDEX_MODES) has no RT to merge: unavailable, not reloading.
    const indexed = mode == null || hubGen !== undefined
    // Freshness comes from the hub's current status when it is at least as new as the document: the alerts
    // document is rewritten only when alerts change, so its own header can be minutes old while the hub is live
    // (Codex review of the split). Content still comes from the document.
    const st = client.status
    const fresh =
      snap &&
      st?.seq != null &&
      st.seq >= snap.header.seq &&
      st.sourceTimestamp != null &&
      st.fetchedAt != null
    const sourceTs = snap ? (fresh ? (st?.sourceTimestamp as number) : snap.header.sourceTimestamp) : null
    const fetchedAt = snap ? (fresh ? (st?.fetchedAt as number) : snap.header.fetchedAt) : null
    const rtState: RtState = rtStateFor(indexed ? sourceTs : null, Math.floor(nowMs / 1000), genOk)
    const ageS = fetchedAt != null ? Math.max(0, (nowMs - fetchedAt) / 1000) : 0
    return {
      cur,
      snap,
      sourceTs,
      rtState,
      nowMs,
      // max-age capped by snapshot age (ADR-0003): max(0, 10 − age).
      cacheControl: `public, max-age=${Math.max(0, Math.floor(10 - ageS))}`,
    }
  }

  // ---------------------------------------------------------------- departures

  app.get('/v1/:mode/stops/:key/departures', async (c) => {
    const mode = parseMode(c)
    if (!mode) return c.json({ error: 'unknown mode' }, 400)
    const key = c.req.param('key')
    const toKey = c.req.query('to') || null
    const limitQ = Number(c.req.query('limit') ?? DEFAULT_LIMIT)
    const limit = Number.isFinite(limitQ)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitQ)))
      : DEFAULT_LIMIT
    // `at` (epoch s): list departures from that time instead of now (the ferry app's "Depart from" picker).
    // `route` (comma-separated route short names): filter before the row limit (used by /v1/ask route questions).
    const routeQ = c.req.query('route')
    const routes = routeQ
      ? new Set(
          routeQ
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean),
        )
      : undefined
    const atQ = c.req.query('at')
    const at = atQ == null || atQ === '' ? null : Number(atQ)
    if (at != null && (!Number.isInteger(at) || at < 0))
      return c.json({ error: 'bad at', detail: 'epoch seconds' }, 400)

    const generation = await deps.store.currentGeneration(mode, waitUntilOf(c))
    if (!generation) return c.json({ error: 'no static data for mode', detail: mode }, 503)
    const index = await deps.store.getIndex(generation, mode)
    if (!index) return c.json({ error: 'static index missing', detail: generation }, 503)

    const datesFor = (ms: number) => overlappingServiceDates(ms).filter((d) => index.serviceDates.includes(d))
    const load = async (ds: string[]) =>
      (await Promise.all(ds.map((d) => deps.store.stopDay(index, d, key)))).filter(
        (d): d is StaticStopDay => d != null,
      )
    // Snapshot, stop index and stop-day files load in parallel (on a cold isolate they were sequential R2 reads).
    // The stop-day load is speculative: its failure only matters for a known stop, and its dates are re-checked
    // against the request's own clock below (Codex review of bcd94a7).
    const early = datesFor(at != null ? at * 1000 : now())
    const [r, stations, speculative] = await Promise.all([
      rt(c, mode, generation),
      stationsFor(deps.store, mode, generation).catch(() => null),
      load(early).then(
        (days) => ({ days, error: null as unknown }),
        (error: unknown) => ({ days: [] as StaticStopDay[], error }),
      ),
    ])
    // Unknown stop: not in the mode's stop index (data/{mode}/stops.json). Without an index, fall back to the static
    // files (a bus shard bucket can't rule a key out). A known stop with no service that day is 200 with no rows.
    if (stations ? !stations.names.has(key) : !mayHaveStop(index, key)) {
      return c.json({ error: 'unknown stop', detail: key }, 404)
    }
    const fromMs = at != null ? at * 1000 : r.nowMs
    const dates = datesFor(fromMs)
    // Reuse the speculative load only for the same dates (and only then does its error matter).
    let days: StaticStopDay[]
    if (dates.join() === early.join()) {
      if (speculative.error) throw speculative.error
      days = speculative.days
    } else {
      days = await load(dates)
    }

    // Train: stopping patterns, plus every platform of the station so core can spot live platform changes
    // (`stationPlatforms`, added to MergeOptions by bft-train #42; ignored by older cores).
    const merge = (ds: StaticStopDay[]) => {
      const stop = describeStop(ds, key, stations)
      let to: DeparturesResponse['to'] = null
      let toStopIds: Set<string> | undefined
      if (toKey) {
        const t = destinationStops(ds, toKey, stations)
        toStopIds = t.ids
        to = { key: toKey, name: t.name ?? toKey }
      }
      const mergeOptions: MergeOptions & { stationPlatforms?: ReadonlyMap<string, string | undefined> } = {
        nowS: Math.floor(fromMs / 1000),
        toStopIds,
        limit,
        rtState: r.rtState,
        boardingStopIds: stop.ids,
        ...(routes ? { routes } : {}),
      }
      if (mode === 'train') {
        mergeOptions.withStopsAfter = true
        const platforms = stations?.platforms.get(key)
        if (platforms) mergeOptions.stationPlatforms = platforms
      }
      const departures: Departure[] = mergeDepartures(
        ds,
        r.rtState === 'live' || r.rtState === 'stale' ? r.snap : null,
        mergeOptions,
        r.cur?.vehiclesByTrip,
      )
      return { stop, to, departures }
    }
    let m = merge(days)
    // Late in the evening today's rows run out: carry on into the next service day ("first ferry tomorrow").
    const next = addDays(dates.at(-1) ?? currentServiceDate(fromMs), 1)
    if (m.departures.length < limit && index.serviceDates.includes(next)) {
      const more = await load([next])
      if (more.length > 0) {
        dates.push(next)
        days.push(...more)
        m = merge(days)
      }
    }
    const { stop, to, departures } = m
    const body: DeparturesResponse = {
      ...envelope(generation, dates, r),
      mode,
      stop: { key, name: stop.name ?? key, stopIds: [...stop.ids] },
      to,
      departures,
    }
    // `at` queries are mostly about later departures, so they can be cached longer.
    // `at` far from now (the Depart-from picker) can be cached for a minute; near now, or with any live, cancelled or
    // skipped row, it keeps the snapshot-capped max-age (Codex review #6).
    // Only when no row carries any RT (status, estimates, GPS, vehicle): otherwise the snapshot-age cap applies.
    const farAt = at != null && Math.abs(at * 1000 - r.nowMs) > AT_LIVE_WINDOW_MS
    const scheduledOnly = departures.every(
      (d) =>
        d.status === 'scheduled' && d.estDep == null && d.estArrTo == null && !d.gps && d.vehicleId == null,
    )
    return c.json(body, 200, {
      'cache-control': farAt && scheduledOnly ? 'public, max-age=60' : r.cacheControl,
    })
  })

  // ---------------------------------------------------------------- trip detail

  app.get('/v1/:mode/trips/:tripInstance', async (c) => {
    const mode = parseMode(c)
    if (!mode) return c.json({ error: 'unknown mode' }, 400)
    const tripInstance = c.req.param('tripInstance')
    if (!/^.+@\d{8}$/.test(tripInstance)) return c.json({ error: 'bad trip instance' }, 400)
    const generation = await deps.store.currentGeneration(mode, waitUntilOf(c))
    if (!generation) return c.json({ error: 'no static data for mode', detail: mode }, 503)
    const r = await rt(c, mode, generation)
    const rtTrip = r.snap?.trips[tripInstance]
    const vehicle = r.cur?.vehiclesByTrip.get(tripInstance) ?? null
    const { serviceDate } = parseTripInstanceKey(tripInstance)
    const live = r.rtState === 'live' || r.rtState === 'stale' ? rtTrip : undefined

    let body: TripResponse | null = null
    if (tripInstance.startsWith('rt:')) {
      const added = rtTrip?.added
      if (!added || r.rtState !== 'live') return c.json({ error: 'unknown trip', detail: tripInstance }, 404)
      body = {
        ...envelope(generation, [serviceDate], r),
        mode,
        tripInstance,
        route: added.route,
        headsign: added.headsign,
        status: 'live',
        vehicle,
        stops: added.stops.map((s) => ({
          stopId: s.stopId,
          stopSequence: s.seq,
          schedArr: null,
          schedDep: null,
          estArr: s.arr,
          estDep: s.dep,
          status: 'live',
          pickup: 0,
          dropOff: 0,
        })),
      }
    } else {
      const index = await deps.store.getIndex(generation, mode)
      const day = index ? await deps.store.tripIndexDay(index, serviceDate) : null
      const { tripId } = parseTripInstanceKey(tripInstance)
      const trip = day ? findTrip(day, tripId) : undefined
      if (!day || !trip) return c.json({ error: 'unknown trip', detail: tripInstance }, 404)
      const stations =
        mode === 'train' ? await stationsFor(deps.store, mode, generation).catch(() => null) : null
      const stops: TripStop[] = []
      for (let i = 0; i + 5 < trip.st.length; i += 6) {
        const [si, seq, arrS, depS, pickup, dropOff] = trip.st.slice(i, i + 6) as number[]
        const schedArr = gtfsToEpoch(serviceDate, arrS as number)
        const schedDep = gtfsToEpoch(serviceDate, depS as number)
        const p = predictStop(live, seq as number, schedArr, schedDep, r.rtState)
        const stopId = day.stops[si as number] ?? ''
        stops.push({
          // platform / scheduledPlatform / stationKey: optional TripStop fields from bft-train #42.
          ...tripStopPlatform(
            stations,
            stopId,
            live?.updates.find((u) => u.seq === seq),
          ),
          stopId,
          stopSequence: seq as number,
          schedArr,
          schedDep,
          estArr: p.estArr,
          estDep: p.estDep,
          status: p.status,
          pickup: boarding(pickup),
          dropOff: boarding(dropOff),
        })
      }
      const tripStatus = stops.some((s) => s.status === 'cancelled')
        ? 'cancelled'
        : stops.some((s) => s.status === 'unknown')
          ? 'unknown'
          : stops.some((s) => s.status === 'live')
            ? 'live'
            : 'scheduled'
      body = {
        ...envelope(generation, [serviceDate], r),
        mode,
        tripInstance,
        route: day.routes[trip.r] ?? { id: '', short: '' },
        headsign: trip.h,
        status: tripStatus,
        vehicle: r.rtState === 'live' ? vehicle : null,
        stops,
      }
    }
    return c.json(body, 200, { 'cache-control': r.cacheControl })
  })

  // ---------------------------------------------------------------- vehicles

  app.get('/v1/:mode/vehicles', async (c) => {
    const mode = parseMode(c)
    if (!mode) return c.json({ error: 'unknown mode' }, 400)
    const route = c.req.query('route') || null
    const bboxQ = c.req.query('bbox') || null
    let bbox: [number, number, number, number] | null = null
    if (bboxQ) {
      const parsed = parseBbox(bboxQ)
      if (!parsed) return c.json({ error: 'bad bbox', detail: 'minLon,minLat,maxLon,maxLat' }, 400)
      const snapped = snapBbox(parsed)
      const canonical = snapped.map((v) => v.toFixed(2)).join(',')
      if (canonical !== bboxQ) {
        // Redirect to the snapped grid cell so caches see a bounded set of keys.
        const u = new URL(c.req.url)
        u.searchParams.set('bbox', canonical)
        return c.redirect(u.pathname + u.search, 308)
      }
      bbox = snapped
    }
    const generation = await deps.store.currentGeneration(mode, waitUntilOf(c))
    const r = await rt(c, mode, generation)
    const all = r.rtState === 'live' ? (r.snap?.vehicles ?? []) : []
    const vehicles = all.filter((v) => {
      if (v.mode !== mode) return false
      if (route && v.routeId !== route && routeKey(v.routeId ?? '') !== route) return false
      if (bbox && (v.lon < bbox[0] || v.lat < bbox[1] || v.lon > bbox[2] || v.lat > bbox[3])) return false
      return true
    })
    const body: VehiclesResponse = {
      ...envelope(generation, r.snap?.header.serviceDates ?? [], r),
      mode,
      vehicles,
    }
    return c.json(body, 200, { 'cache-control': r.cacheControl })
  })

  // ---------------------------------------------------------------- alerts

  app.get('/v1/alerts', async (c) => {
    const modeQ = c.req.query('mode')
    const mode = modeQ ? Mode.safeParse(modeQ) : null
    if (mode && !mode.success) return c.json({ error: 'unknown mode' }, 400)
    const route = c.req.query('route') || null
    const stop = c.req.query('stop') || null
    const r = await rt(c, null, null)
    const nowS = Math.floor(r.nowMs / 1000)
    const alerts = (r.snap?.alerts ?? []).filter((a) => {
      // A mode filter keeps that mode's alerts plus network-wide notices (no route, no stop).
      const networkWide = a.modes.length === 0 && a.routes.length === 0 && a.stops.length === 0
      if (mode?.success && !a.modes.includes(mode.data) && !networkWide) return false
      if (route && !a.routes.some((x) => x === route || routeKey(x) === route)) return false
      if (stop && !a.stops.includes(stop)) return false
      // Drop alerts whose every active period has ended.
      if (a.activePeriods.length > 0 && a.activePeriods.every((p) => p.end != null && p.end < nowS))
        return false
      return true
    })
    const body: AlertsResponse = { ...envelope(null, r.snap?.header.serviceDates ?? [], r), alerts }
    return c.json(body, 200, { 'cache-control': 'public, max-age=60' })
  })

  // ---------------------------------------------------------------- health

  app.get('/v1/health', async (c) => {
    const nowMs = now()
    const client = deps.snapshotsFor?.('alerts') ?? deps.snapshots
    const [manifest, cur] = await Promise.all([
      deps.store.getManifest(waitUntilOf(c)).catch(() => null),
      client.get(waitUntilOf(c)),
    ])
    const status = client.status
    // The hub status (from the pointer) is the freshest view; the alerts document's header can lag up to 60 s.
    const hdr = cur?.snapshot.header
    const h =
      status?.seq != null && status.sourceTimestamp != null && status.fetchedAt != null
        ? {
            seq: status.seq,
            sourceTimestamp: status.sourceTimestamp,
            fetchedAt: status.fetchedAt,
            stats: status.stats ?? hdr?.stats,
          }
        : hdr
    const generations: Record<string, string> = {}
    for (const [m, v] of Object.entries(manifest?.modes ?? {})) if (v) generations[m] = v.current
    // Judge the source, not the build: a hub that keeps rebuilding from retained data while TripUpdates fail must
    // not look healthy (Codex review #5). ageS is the age of TransLink's header time behind the snapshot.
    const ageS = h ? Math.round((nowMs - h.sourceTimestamp * 1000) / 100) / 10 : null
    const buildAgeS = h ? (nowMs - h.fetchedAt) / 1000 : null
    const body: HealthResponse = {
      schemaVersion: SCHEMA_VERSION,
      ok: manifest != null && ageS != null && ageS < 120 && buildAgeS != null && buildAgeS < 120,
      now: nowMs,
      manifest: { updatedAt: manifest?.updatedAt ?? null, generations },
      rt: {
        seq: h?.seq ?? null,
        sourceTimestamp: h?.sourceTimestamp ?? null,
        fetchedAt: h?.fetchedAt ?? null,
        ageS,
        lastError: status?.lastError ?? null,
        stats: h?.stats ? statsRecord(h.stats) : null,
      },
      ai: deps.aiStatus
        ? await deps.aiStatus().catch(() => ({ enabled: false, budgetUsedUsd: null }))
        : { enabled: false, budgetUsedUsd: null },
    }
    return c.json(body, body.ok ? 200 : 503, { 'cache-control': 'no-store' })
  })

  // ---------------------------------------------------------------- static client data passthrough

  app.get('/data/:mode/*', async (c) => {
    const mode = parseMode(c)
    if (!mode) return c.json({ error: 'unknown mode' }, 400)
    const rest = c.req.path.slice(`/data/${mode}/`.length)
    if (!rest || rest.split('/').some((s) => s === '..' || s === ''))
      return c.json({ error: 'bad path' }, 400)
    const obj = await deps.store.source.get(`data/${mode}/${rest}`)
    if (!obj) return c.json({ error: 'not found' }, 404)
    const headers: Record<string, string> = {
      'content-type': rest.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      // Paths are stable and rewritten each publish, so cacheable but not immutable.
      'cache-control': 'public, max-age=300',
    }
    if (obj.etag) headers.etag = obj.etag
    return new Response(obj.body, { headers })
  })

  // ---------------------------------------------------------------- legacy compatibility (Phase 2 prep)

  app.get('/api/gtfs-proxy', async (c) => {
    const endpoint = c.req.query('endpoint')
    if (!endpoint) return c.json({ error: 'Endpoint parameter is required' }, 400)
    const keys = legacyFeedKeys(endpoint, deps.combinedFeeds, deps.polledModes)
    if (!keys) return c.json({ error: 'Unknown endpoint', detail: endpoint }, 400)
    // Never fetch upstream here: serve what the hub stored, or 503.
    const raws = await Promise.all(keys.map((k) => deps.snapshots.raw(k)))
    const parts = raws.filter((r) => r != null)
    if (parts.length === 0) {
      return c.json({ error: 'Realtime feed not available yet' }, 503, { 'cache-control': 'no-store' })
    }
    // Concatenated protobuf FeedMessages parse as one message: entities append, the header's fields merge.
    const body = parts.length === 1 ? (parts[0]?.bytes as Uint8Array) : concatBytes(parts.map((p) => p.bytes))
    return new Response(body as unknown as ArrayBuffer, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=10' },
    })
  })

  app.get('/schedule-data/latest.json', async (c) => {
    const obj = await deps.store.source.get('legacy/latest.json')
    if (!obj) return c.json({ error: 'not found' }, 404)
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    }
    if (obj.etag) headers.etag = obj.etag
    return new Response(obj.body, { headers })
  })

  return app
}

// ------------------------------------------------------------------ helpers

/** The request's waitUntil, when running in a Worker (tests and scripts have no execution context). */
function waitUntilOf(c: Context<Env>): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx
    return (p) => ctx.waitUntil(p)
  } catch {
    return undefined
  }
}

function statsRecord<T>(stats: Partial<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(stats)) if (v) out[k] = v
  return out
}

function envelope(
  generation: string | null,
  serviceDates: string[],
  r: { sourceTs: number | null; rtState: RtState; nowMs: number },
) {
  return {
    schemaVersion: SCHEMA_VERSION,
    staticGeneration: generation,
    serviceDates,
    rtSourceTimestamp: r.sourceTs,
    rtState: r.rtState,
    generatedAt: r.nowMs,
  }
}

const boarding = (n: number | undefined): 0 | 1 | 2 | 3 => (n === 1 || n === 2 || n === 3 ? n : 0)

/** The stop's display name (stop index first) and every platform stop id it boards at. */
function describeStop(
  days: StaticStopDay[],
  key: string,
  stations: Stations | null,
): { name: string | null; ids: Set<string> } {
  const ids = new Set<string>()
  let name: string | null = stations?.names.get(key) ?? null
  for (const day of days) {
    for (const ev of day.events) {
      const s = day.stops[ev[6]]
      if (s) ids.add(s.id)
    }
    const self = day.stops.find((s) => s.key === key || s.id === key)
    name ??= self?.name ?? null
  }
  if (ids.size === 0) ids.add(key)
  return { name, ids }
}

/**
 * Destination stop ids for `to`: every platform the stop index lists for that station, plus any stop in the files
 * whose key (station slug) or id matches. Downstream StopRefs may omit key and name, so the index comes first.
 */
function destinationStops(
  days: StaticStopDay[],
  to: string,
  stations: Stations | null,
): { name: string | null; ids: Set<string> } {
  const ids = new Set<string>(stations?.platforms.get(to)?.keys() ?? [])
  let name: string | null = stations?.names.get(to) ?? null
  for (const day of days) {
    for (const s of day.stops) {
      if (s.key === to || s.id === to) {
        ids.add(s.id)
        name ??= s.name ?? null
      }
    }
  }
  // Unknown destination: keep the key so the merge filters to nothing rather than to everything.
  if (ids.size === 0) ids.add(to)
  return { name, ids }
}

const tripLookup = new WeakMap<TripIndexDay, Map<string, TripIndexDay['trips'][number]>>()
function findTrip(day: TripIndexDay, tripId: string) {
  let m = tripLookup.get(day)
  if (!m) {
    m = new Map(day.trips.map((t) => [t.id, t]))
    tripLookup.set(day, m)
  }
  return m.get(tripId)
}

export function parseBbox(q: string): [number, number, number, number] | null {
  const p = q.split(',').map(Number)
  if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) return null
  const [a, b, c, d] = p as [number, number, number, number]
  if (a >= c || b >= d || Math.abs(b) > 90 || Math.abs(d) > 90) return null
  return [a, b, c, d]
}

export function snapBbox([a, b, c, d]: [number, number, number, number]): [number, number, number, number] {
  const g = BBOX_GRID
  const down = (v: number) => Math.round(Math.floor(v / g + 1e-9) * g * 100) / 100
  const up = (v: number) => Math.round(Math.ceil(v / g - 1e-9) * g * 100) / 100
  return [down(a), down(b), up(c), up(d)]
}

/**
 * Map a legacy `endpoint=` value (the old app sends TripUpdates, VehiclePositions, Alerts; per-mode suffixes
 * like `TripUpdates/Ferry` are accepted too) onto the hub's stored feed keys.
 * - Combined requested, per-mode polled: the polled per-mode feeds, concatenated (a subset: the legacy ferry app
 *   only reads ferry entities).
 * - Per-mode requested, combined polled: the combined feed (a superset; clients filter by route).
 */
export function legacyFeedKeys(endpoint: string, combined: boolean, modes: Mode[]): string[] | null {
  const [kindRaw, suffixRaw] = endpoint.split('/')
  const kindL = (kindRaw ?? '').toLowerCase()
  const kind =
    kindL === 'tripupdates'
      ? 'TripUpdates'
      : kindL === 'vehiclepositions'
        ? 'VehiclePositions'
        : kindL === 'alerts'
          ? 'alerts'
          : null
  if (!kind) return null
  if (kind === 'alerts') return suffixRaw ? null : ['alerts']
  if (suffixRaw) {
    const mode = MODES.find((m) => FEED_MODE_SUFFIX[m].toLowerCase() === suffixRaw.toLowerCase())
    if (!mode) return null
    if (combined) return [kind]
    return modes.includes(mode) ? [`${kind}/${FEED_MODE_SUFFIX[mode]}`] : []
  }
  return combined ? [kind] : modes.map((m) => `${kind}/${FEED_MODE_SUFFIX[m]}`)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}
