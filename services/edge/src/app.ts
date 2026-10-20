/**
 * The /v1 API (transit-architecture.md §3.8) plus the Phase 2 legacy compatibility routes.
 * Built from injected dependencies so tests run it in Node against a memory data source and a real HubCore.
 */
import {
  type AlertsResponse,
  addDays,
  BUILD_HEADER,
  buildId,
  currentServiceDate,
  type Departure,
  type DeparturesResponse,
  type GeoTileFile,
  gtfsToEpoch,
  type HealthResponse,
  MAX_PLACE_STOPS,
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
import type { DataObject } from './data/source.ts'
import {
  mayHaveStop,
  type ReadBudget,
  readBudget,
  StaticReadError,
  type StaticStore,
} from './data/static-store.ts'
import { within } from './deadline.ts'
import { HEALTH_MAX_AGE_S, healthDetail, healthReasons, rtAges } from './health.ts'
import { createLogger, errorMessage, type Logger } from './log.ts'
import { REQUEST_DEADLINE_MS } from './request-deadline.ts'
import { FEED_MODE_SUFFIX, MODES } from './rt/feeds.ts'
import type { SnapshotScope } from './rt/split.ts'
import type { SnapshotClient } from './snapshot-client.ts'
import { type Stations, stationsFor, stopNameFor, tripStopPlatform } from './stations.ts'

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
  /** Deployed short sha (buildId of BUILD_SHA): the x-bft-build header on every response and health.build. */
  build?: string
  /** Override PASSTHROUGH_DEADLINE_MS (tests). */
  passthroughDeadlineMs?: number
  /** Override STATIC_READ_BUDGET_MS (tests). */
  staticReadBudgetMs?: number
}

/** A server error's code and a trusted id (a mode or generation, never user input), for the request log line. */
type Failure = { error: string; detail?: string; retryable?: true }

/**
 * A 200 that is less than the full answer, for the request log line: the generation came from the RT snapshot
 * (manifest unreadable), or the next service day's rows were left off (that read failed).
 */
type Degraded = 'generation-from-rt' | 'next-day-skipped'

type Env = {
  Variables: { rid: string; log: Logger; failure?: Failure; budget: ReadBudget; degraded?: Degraded[] }
}

/**
 * Static reads on a /v1 request stop retrying and answer 503 by this long after the request starts: under the 7 s
 * GET backstop (REQUEST_DEADLINE_MS), with a second left to merge and answer.
 */
export const STATIC_READ_BUDGET_MS = REQUEST_DEADLINE_MS - 1_000

/**
 * The /data and /schedule-data passthroughs wait this long for the object to start (R2 metadata, or the data
 * Worker's response headers); the body then streams. See the PR for the measurements.
 */
export const PASSTHROUGH_DEADLINE_MS = 3_000

/**
 * A 5xx JSON error that the `request` log line also names. Recorded where the response is built rather than read
 * back from the body, so logging never waits on or reads a response stream (Codex r1). Pass as `detail` only an id
 * the app itself produced.
 */
function serverError(
  c: Context<Env>,
  status: 500 | 502 | 503 | 504,
  error: string,
  detail?: string,
  headers?: Record<string, string>,
  retryable?: true,
) {
  const failure: Failure = detail === undefined ? { error } : { error, detail }
  if (retryable) failure.retryable = true
  c.set('failure', failure)
  return c.json(failure, status, headers)
}

/** A static read that failed after its retry (StaticReadError): retryable, never cached. */
function staticUnavailable(c: Context<Env>, detail: string) {
  return serverError(
    c,
    503,
    'static data unavailable',
    detail,
    { 'cache-control': 'no-store', 'retry-after': '2' },
    true,
  )
}

const degrade = (c: Context<Env>, d: Degraded) => c.set('degraded', [...(c.get('degraded') ?? []), d])

const DEFAULT_LIMIT = 20
/** `at` within this of now is treated as a live query for caching. */
const AT_LIVE_WINDOW_MS = 2 * 60_000
const MAX_LIMIT = 100
/** A stop key in a comma-separated `to` (stop ids and station slugs). */
const STOP_KEY = /^[A-Za-z0-9_-]{1,64}$/
/** bbox queries snap outward to this grid (degrees) so cache keys stay bounded. */
export const BBOX_GRID = 0.05

export function createApp(deps: AppDeps): Hono<Env> {
  const app = new Hono<Env>()
  const now = deps.now ?? Date.now
  const baseLog = deps.log ?? createLogger({ svc: 'bft-api' })
  const build = buildId(deps.build)

  // Request id, build marker, structured access log, CORS (legacy parity) on every response.
  app.use('*', async (c, next) => {
    const rid = c.req.header('cf-ray') ?? crypto.randomUUID()
    const log = baseLog.child({ rid })
    c.set('rid', rid)
    c.set('log', log)
    const t0 = now()
    const cors = corsHeaders(c.req.header('origin'), deps.corsAllowAll ?? false, log, c.req.path)
    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: { ...cors, 'x-request-id': rid, [BUILD_HEADER]: build },
      })
    }
    c.set('budget', readBudget(deps.staticReadBudgetMs ?? STATIC_READ_BUDGET_MS, t0))
    await next()
    for (const [k, v] of Object.entries(cors)) c.res.headers.set(k, v)
    c.res.headers.set('x-request-id', rid)
    c.res.headers.set(BUILD_HEADER, build)
    // A server error names its cause (the 503s below were indistinguishable by status and ms, staging 20 Oct).
    const failure = c.res.status >= 500 ? c.get('failure') : undefined
    const degraded = c.res.status < 300 ? c.get('degraded') : undefined
    log.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: now() - t0,
      ...failure,
      ...(degraded ? { degraded } : {}),
    })
  })

  app.onError((err, c) => {
    // A static read that timed out or failed even after its retry: a deliberate, retryable 503, not a 500.
    if (err instanceof StaticReadError) {
      c.get('log')?.warn('static read failed', { what: err.what, why: err.why, error: errorMessage(err) })
      return staticUnavailable(c, `${err.what} ${err.why}`)
    }
    c.get('log')?.error('unhandled', { error: errorMessage(err) })
    return serverError(c, 500, 'internal error', undefined, { 'cache-control': 'no-store' })
  })
  app.notFound((c) => c.json({ error: 'not found' }, 404))

  const parseMode = (c: Context<Env>): Mode | null => {
    const r = Mode.safeParse(c.req.param('mode'))
    return r.success ? r.data : null
  }

  /** Snapshot plus the rtState for one mode's static generation. */
  async function rt(c: Context<Env>, mode: Mode | null, generation: string | null) {
    const client = deps.snapshotsFor?.(mode ?? 'alerts') ?? deps.snapshots
    // Past the request's static-read budget the RT wait ends too, so the answer (scheduled rows, or a 503 for a
    // failed static read) still beats the backstop.
    const cur = await client.get(waitUntilOf(c), waitSignal(c))
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
    let rtState: RtState = rtStateFor(indexed ? sourceTs : null, Math.floor(nowMs / 1000), genOk)
    // A copy no refresh has confirmed for maxStaleMs (this request's wait for the refresh ran out, or the refresh
    // failed) is served, and is live only while its own TransLink source is as fresh as health allows. A quiet
    // isolate's copy is often just over a minute old when the next request finds it, and the 4.6 MB bus document
    // can't refresh inside RT_WAIT_MS, so judging the copy's age alone showed "Live times delayed" on data 44-106 s
    // old (R13-B1, staging 20 Oct). A real stall (R14-RT1) is past this, and past STALE_AFTER_S soon after.
    if (
      rtState === 'live' &&
      client.expired &&
      (sourceTs == null || nowMs / 1000 - sourceTs >= HEALTH_MAX_AGE_S)
    ) {
      rtState = 'stale'
    }
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

  /**
   * The mode's current static generation. On an isolate with no good manifest whose manifest read failed even after
   * its retry, fall back to the generation the RT hub's snapshot was built on (generations are immutable), but only
   * once that generation's index loads. Bus has none (the hub doesn't index it), so it answers 503.
   */
  async function generationOf(c: Context<Env>, mode: Mode): Promise<string | null> {
    const budget = c.get('budget')
    try {
      return await deps.store.currentGeneration(mode, waitUntilOf(c), budget)
    } catch (e) {
      if (!(e instanceof StaticReadError)) throw e
      // Within what is left of the budget only (Codex r1): with none left, the original error answers at once.
      if (budget.signal.aborted) throw e
      const client = deps.snapshotsFor?.(mode) ?? deps.snapshots
      const cur = await client.get(waitUntilOf(c), waitSignal(c))
      const generation = cur?.snapshot.header.staticGeneration[mode]
      if (!generation || budget.signal.aborted) throw e
      const index = await deps.store.getIndex(generation, mode, budget).catch(() => null)
      if (!index) throw e
      const last = deps.store.lastManifest?.modes[mode]?.current ?? null
      c.get('log').warn('static generation from the rt snapshot', {
        mode,
        generation,
        lastManifestGeneration: last,
        differs: last != null && last !== generation,
        error: errorMessage(e),
      })
      degrade(c, 'generation-from-rt')
      return generation
    }
  }

  /** A passthrough object (headers only: the body then streams), or a 503 when the read fails or doesn't start. */
  async function passthrough(c: Context<Env>, key: string): Promise<DataObject | null | Response> {
    try {
      return await within(
        deps.store.source.get(key),
        deps.passthroughDeadlineMs ?? PASSTHROUGH_DEADLINE_MS,
        'passthrough',
      )
    } catch (e) {
      c.get('log').warn('static read failed', { what: 'passthrough', error: errorMessage(e) })
      return staticUnavailable(c, 'passthrough')
    }
  }

  // ---------------------------------------------------------------- departures

  app.get('/v1/:mode/stops/:key/departures', async (c) => {
    const mode = parseMode(c)
    if (!mode) return c.json({ error: 'unknown mode' }, 400)
    const key = c.req.param('key')
    const toKey = c.req.query('to') || null
    // `to` may list the stops of one place, comma-separated (/v1/ask's grouped busway platforms, R11-A1): a few
    // well-formed keys only. A single key is used as given, as before.
    const toKeys = toKey?.includes(',') ? toKey.split(',') : null
    if (toKeys && (toKeys.length > MAX_PLACE_STOPS || !toKeys.every((k) => STOP_KEY.test(k))))
      return c.json({ error: 'bad to', detail: `up to ${MAX_PLACE_STOPS} comma-separated stop keys` }, 400)
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

    const budget = c.get('budget')
    const generation = await generationOf(c, mode)
    if (!generation) return serverError(c, 503, 'no static data for mode', mode)
    const index = await deps.store.getIndex(generation, mode, budget)
    if (!index) return serverError(c, 503, 'static index missing', generation)

    const datesFor = (ms: number) => overlappingServiceDates(ms).filter((d) => index.serviceDates.includes(d))
    const load = async (ds: string[]) =>
      (await Promise.all(ds.map((d) => deps.store.stopDay(index, d, key, budget)))).filter(
        (d): d is StaticStopDay => d != null,
      )
    // Snapshot, stop index and stop-day files load in parallel (on a cold isolate they were sequential R2 reads).
    // The stop-day load is speculative: its failure only matters for a known stop, and its dates are re-checked
    // against the request's own clock below (Codex review of bcd94a7).
    const early = datesFor(at != null ? at * 1000 : now())
    const [r, stations, speculative] = await Promise.all([
      rt(c, mode, generation),
      stationsFor(deps.store, mode, generation, c.get('budget').signal).catch(() => null),
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
        const ts = (toKeys ?? [toKey]).map((k) => destinationStops(ds, k, stations))
        toStopIds = new Set(ts.flatMap((t) => [...t.ids]))
        to = { key: toKey, name: ts.find((t) => t.name)?.name ?? toKey }
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
      // Today's rows are in hand: if the next day's read fails, answer with them (the log line says so).
      const more = await load([next]).catch((e: unknown) => {
        if (!(e instanceof StaticReadError)) throw e
        c.get('log').warn('next-day top-up skipped', { what: e.what, why: e.why, error: errorMessage(e) })
        degrade(c, 'next-day-skipped')
        return []
      })
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
    // A set-down-only stop (no service picks up here): say where to board instead.
    const boardAt = stations?.boardAt.get(key)
    if (boardAt) body.stop.boardAt = boardAt
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
    const budget = c.get('budget')
    const generation = await generationOf(c, mode)
    if (!generation) return serverError(c, 503, 'no static data for mode', mode)
    const r = await rt(c, mode, generation)
    const rtTrip = r.snap?.trips[tripInstance]
    const vehicle = r.cur?.vehiclesByTrip.get(tripInstance) ?? null
    const { serviceDate } = parseTripInstanceKey(tripInstance)
    const live = r.rtState === 'live' || r.rtState === 'stale' ? rtTrip : undefined
    // Stop names from the stop index (already loaded per isolate by the departures route), so clients get "Edward
    // Street Stop 142 near Queen St", not "Stop 142". Train apps name stations from `stationKey` and their own
    // network, so train trip stops stay unnamed.
    const names =
      mode === 'train' ? null : stationsFor(deps.store, mode, generation, budget.signal).catch(() => null)
    const named = async (stops: TripStop[]): Promise<TripStop[]> => {
      const stations = await names
      if (!stations) return stops
      return stops.map((s) => {
        const name = stopNameFor(stations, s.stopId)
        return name ? { ...s, name } : s
      })
    }

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
        stops: await named(
          added.stops.map((s) => ({
            stopId: s.stopId,
            stopSequence: s.seq,
            schedArr: null,
            schedDep: null,
            estArr: s.arr,
            // Same rule as predictStop: a vehicle can't leave a stop before it arrives there.
            estDep: Math.max(s.dep, s.arr),
            status: 'live',
            pickup: 0,
            dropOff: 0,
          })),
        ),
      }
    } else {
      const index = await deps.store.getIndex(generation, mode, budget)
      if (!index) return serverError(c, 503, 'static index missing', generation)
      const day = await deps.store.tripIndexDay(index, serviceDate, budget)
      const { tripId } = parseTripInstanceKey(tripInstance)
      const trip = day ? findTrip(day, tripId) : undefined
      if (!day || !trip) return c.json({ error: 'unknown trip', detail: tripInstance }, 404)
      const stations =
        mode === 'train'
          ? await stationsFor(deps.store, mode, generation, budget.signal).catch(() => null)
          : null
      const stops: TripStop[] = []
      for (let i = 0; i + 5 < trip.st.length; i += 6) {
        const [si, seq, arrS, depS, pickup, dropOff] = trip.st.slice(i, i + 6) as number[]
        const schedArr = gtfsToEpoch(serviceDate, arrS as number)
        const schedDep = gtfsToEpoch(serviceDate, depS as number)
        // The last stop shows its arrival (nobody departs there); every other stop shows the departure.
        const last = i + 6 + 5 >= trip.st.length
        const p = predictStop(live, seq as number, schedArr, schedDep, r.rtState, last ? 'arr' : 'dep')
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
        stops: await named(stops),
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
    // Vehicles need the generation only to tell whether RT matches it: without one they degrade to none.
    const generation = await generationOf(c, mode).catch((e: unknown) => {
      if (e instanceof StaticReadError) return null
      throw e
    })
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
      client.get(waitUntilOf(c), c.req.raw.signal),
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
    const ages = rtAges(h, nowMs)
    const { ageS, buildAgeS } = ages
    const reasons = healthReasons(manifest != null, ages)
    const body: HealthResponse = {
      schemaVersion: SCHEMA_VERSION,
      ok: reasons.length === 0,
      // Why a 503 is one (R15-H1), always present: [] on a 200.
      reasons,
      now: nowMs,
      manifest: { updatedAt: manifest?.updatedAt ?? null, generations },
      rt: {
        seq: h?.seq ?? null,
        sourceTimestamp: h?.sourceTimestamp ?? null,
        fetchedAt: h?.fetchedAt ?? null,
        ageS,
        buildAgeS,
        lastError: status?.lastError ?? null,
        stats: h?.stats ? statsRecord(h.stats) : null,
      },
      ai: deps.aiStatus
        ? await deps.aiStatus().catch(() => ({ enabled: false, budgetUsedUsd: null }))
        : { enabled: false, budgetUsedUsd: null },
      build,
    }
    // The body says why in `reasons`; the log line keeps its R14-RT1 `detail` with the ages (e.g. `source-age 446s`),
    // so an upstream freeze reads differently from a hub or pointer that stopped.
    if (!body.ok) c.set('failure', { error: 'health not ok', detail: healthDetail(reasons, ages) })
    return c.json(body, body.ok ? 200 : 503, { 'cache-control': 'no-store' })
  })

  // ---------------------------------------------------------------- static client data passthrough

  app.get('/data/:mode/*', async (c) => {
    const mode = parseMode(c)
    if (!mode) return c.json({ error: 'unknown mode' }, 400)
    const rest = c.req.path.slice(`/data/${mode}/`.length)
    if (!rest || rest.split('/').some((s) => s === '..' || s === ''))
      return c.json({ error: 'bad path' }, 400)
    const obj = await passthrough(c, `data/${mode}/${rest}`)
    if (obj instanceof Response) return obj
    if (!obj) {
      // The pipeline publishes only tiles that have stops, but a client asks for its cell and the 8 around it.
      // A well-formed tile path is "no stops here": answer an empty tile, not a 404 that every browser logs as an
      // error (smoke test X2). The object is missing (a read error throws), so this holds even when the manifest
      // can't be read right now or the mode has no generation yet (R3-X8); then it's cached only briefly.
      const tile = /^geo\/([0-9b-hjkmnp-z]{5})\.json$/.exec(rest)
      if (tile) {
        const generation = await deps.store.currentGeneration(mode, waitUntilOf(c)).catch(() => null)
        const empty: GeoTileFile = {
          schemaVersion: SCHEMA_VERSION,
          mode,
          generation: generation ?? '',
          geohash: tile[1] as string,
          stops: [],
        }
        return c.json(empty, 200, { 'cache-control': `public, max-age=${generation ? 300 : 30}` })
      }
      return c.json({ error: 'not found' }, 404)
    }
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
    const raws = await Promise.all(keys.map((k) => deps.snapshots.raw(k, c.req.raw.signal)))
    const parts = raws.filter((r) => r != null)
    if (parts.length === 0) {
      return serverError(c, 503, 'Realtime feed not available yet', undefined, {
        'cache-control': 'no-store',
      })
    }
    // Concatenated protobuf FeedMessages parse as one message: entities append, the header's fields merge.
    const body = parts.length === 1 ? (parts[0]?.bytes as Uint8Array) : concatBytes(parts.map((p) => p.bytes))
    return new Response(body as unknown as ArrayBuffer, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=10' },
    })
  })

  app.get('/schedule-data/latest.json', async (c) => {
    const obj = await passthrough(c, 'legacy/latest.json')
    if (obj instanceof Response) return obj
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

/** The caller's abort, or the end of the request's static-read budget, whichever comes first. */
function waitSignal(c: Context<Env>): AbortSignal {
  const budget = c.get('budget').signal
  const caller = c.req.raw.signal
  return caller ? AbortSignal.any([caller, budget]) : budget
}

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
