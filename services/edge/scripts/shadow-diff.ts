/**
 * Phase 1 shadow diff (transit-architecture.md §7): for every ferry stop pair, compare /v1/ferry departures
 * (the new data + mergeDepartures, through the real Hono app) with what the legacy app computes from
 * schedule-data/latest.json (a faithful, read-only port of src/services/staticGtfsService.js
 * fetchGitHubSchedule + processGitHubDepartures). Tolerance: same trips, times within ±1 min.
 *
 *   node --experimental-transform-types scripts/shadow-diff.ts --legacy ../../schedule-data/latest.json \
 *     --data ../data/out [--at 2026-10-18T04:00:00Z] [--out report-dir] [--api https://bft-api.brisbanetransit.workers.dev]
 *
 * --data runs the API in-process against a local output tree (time-travel via --at, paged over the whole 24 h
 * window). --api queries a deployed /v1 instead (real time, first 100 departures per pair).
 * Exit code: 0 within tolerance, 1 differences found, 2 bad input.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Departure, DeparturesResponse } from '@bft/core'
import { createApp } from '../src/app.ts'
import { LocalDirDataSource } from '../src/data/local.ts'
import { StaticStore } from '../src/data/static-store.ts'
import { silentLogger } from '../src/log.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? '') : def
}

const TOLERANCE_S = 60
const DAY_MS = 24 * 3600 * 1000

// ------------------------------------------------------------------ legacy port (read-only copy of src/ logic)

interface LegacyFile {
  generated: string
  validFrom: string
  validTo: string
  departures: Array<{
    tripId: string
    routeId: string
    departureTime: string
    stopId: string
    stopSequence: number
  }>
  ferryStops: Record<string, { name: string; validDestinations?: string[] }>
  stopConnectivity?: Record<string, string[]>
}

interface LegacyDep {
  tripId: string
  routeId: string
  stopId: string
  stopSequence: number
  departureTime: Date
  destinationArrivalTime: Date
  direction: 'outbound' | 'inbound'
}

/** fetchGitHubSchedule: Date conversion and the next-24-hours filter. */
export function legacyWindow(file: LegacyFile, now: Date) {
  const cutoff = new Date(now.getTime() + DAY_MS)
  return file.departures
    .map((dep) => ({ ...dep, departureTime: new Date(dep.departureTime) }))
    .filter((dep) => dep.departureTime > now && dep.departureTime < cutoff)
}

/** processGitHubDepartures, unchanged in behaviour (constants.js ROUTES: F11 express, F1 all-stops). */
export function processGitHubDepartures(
  allDepartures: ReturnType<typeof legacyWindow>,
  selectedStops: { outbound: { id: string }; inbound: { id: string } },
): LegacyDep[] {
  const relevantStopIds = [selectedStops.outbound.id, selectedStops.inbound.id]
  const relevantRouteIds = ['F11', 'F1']
  const departuresByTrip = new Map<string, typeof allDepartures>()
  for (const dep of allDepartures) {
    if (!departuresByTrip.has(dep.tripId)) departuresByTrip.set(dep.tripId, [])
    departuresByTrip.get(dep.tripId)?.push(dep)
  }
  const out: LegacyDep[] = []
  for (const dep of allDepartures) {
    if (!relevantStopIds.includes(dep.stopId)) continue
    if (!relevantRouteIds.some((r) => dep.routeId === r || dep.routeId.startsWith(r))) continue
    const tripStops = departuresByTrip.get(dep.tripId) || []
    tripStops.sort((a, b) => a.stopSequence - b.stopSequence)
    const currentIndex = tripStops.findIndex(
      (s) => s.stopId === dep.stopId && s.stopSequence === dep.stopSequence,
    )
    if (currentIndex === -1) continue
    const remainingStops = tripStops.slice(currentIndex + 1)
    const destinationStopId =
      dep.stopId === selectedStops.outbound.id ? selectedStops.inbound.id : selectedStops.outbound.id
    const destinationStop = remainingStops.find((s) => s.stopId === destinationStopId)
    if (!destinationStop) continue
    out.push({
      ...dep,
      destinationArrivalTime: new Date(destinationStop.departureTime),
      direction: dep.stopId === selectedStops.outbound.id ? 'outbound' : 'inbound',
    })
  }
  return out
}

// ------------------------------------------------------------------ /v1 side

type V1Fetch = (origin: string, dest: string, fromMs: number, untilMs: number) => Promise<Departure[]>

function inProcessV1(dataDir: string): V1Fetch {
  let nowMs = 0
  const store = new StaticStore(new LocalDirDataSource(dataDir), { validate: true })
  const noHub = new SnapshotClient(
    {
      pull: async () => ({
        seq: null,
        json: null,
        status: {
          seq: null,
          sourceTimestamp: null,
          fetchedAt: null,
          lastCycleAt: null,
          lastError: null,
          stats: null,
          generations: {},
        },
      }),
      getRaw: async () => null,
    },
    () => nowMs,
    () => {},
    null,
  )
  const app = createApp({
    store,
    snapshots: noHub,
    now: () => nowMs,
    log: silentLogger,
    combinedFeeds: false,
    polledModes: [],
  })
  return async (origin, dest, fromMs, untilMs) => {
    const seen = new Map<string, Departure>()
    let cursor = fromMs
    for (let page = 0; page < 50; page++) {
      nowMs = cursor
      const res = await app.request(`/v1/ferry/stops/${origin}/departures?to=${dest}&limit=100`)
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`/v1 ${origin}→${dest}: HTTP ${res.status}`)
      const body = DeparturesResponse.parse(await res.json())
      const fresh = body.departures.filter((d) => !seen.has(d.tripInstance))
      for (const d of fresh) seen.set(d.tripInstance, d)
      const last = body.departures.at(-1)
      if (!last || fresh.length === 0 || last.schedDep * 1000 >= untilMs) break
      // grace is 30 s, so this re-includes departures at the same second as `last` (deduped above).
      cursor = last.schedDep * 1000 + 30_000
    }
    return [...seen.values()].filter((d) => d.schedDep * 1000 > fromMs && d.schedDep * 1000 < untilMs)
  }
}

function remoteV1(base: string): V1Fetch {
  return async (origin, dest) => {
    const res = await fetch(
      `${base.replace(/\/$/, '')}/v1/ferry/stops/${origin}/departures?to=${dest}&limit=100`,
    )
    if (res.status === 404) return []
    if (!res.ok) throw new Error(`/v1 ${origin}→${dest}: HTTP ${res.status}`)
    return DeparturesResponse.parse(await res.json()).departures
  }
}

// ------------------------------------------------------------------ compare

interface Row {
  tripId: string
  route: string
  dep: number
  arr: number | null
}

interface PairReport {
  origin: string
  dest: string
  legacy: number
  v1: number
  matched: number
  legacyOnly: Row[]
  v1Only: Row[]
  timeMismatch: Array<{ legacy: Row; v1: Row }>
  /** v1 rows on routes the legacy app never shows (not F1/F11): informational, not a difference. */
  v1OtherRoutes: number
}

const legacyRoute = (routeId: string) => routeId.startsWith('F11') || routeId.startsWith('F1')

export function comparePair(
  origin: string,
  dest: string,
  legacy: LegacyDep[],
  v1: Departure[],
  untilMs: number,
): PairReport {
  const L: Row[] = legacy
    .filter((d) => d.direction === 'outbound' && d.departureTime.getTime() < untilMs)
    .map((d) => ({
      tripId: d.tripId,
      route: d.routeId,
      dep: Math.floor(d.departureTime.getTime() / 1000),
      arr: Math.floor(d.destinationArrivalTime.getTime() / 1000),
    }))
  const all: Row[] = v1.map((d) => ({
    tripId: d.tripInstance.slice(0, d.tripInstance.lastIndexOf('@')),
    route: d.route.id,
    dep: d.schedDep,
    arr: d.schedArrTo,
  }))
  // Legacy quirk: its 24 h window also cuts the destination stop, so a trip arriving after the window is dropped.
  const V = all.filter((r) => legacyRoute(r.route) && (r.arr == null || r.arr * 1000 < untilMs))
  const used = new Set<number>()
  const report: PairReport = {
    origin,
    dest,
    legacy: L.length,
    v1: V.length,
    matched: 0,
    legacyOnly: [],
    v1Only: [],
    timeMismatch: [],
    v1OtherRoutes: all.length - V.length,
  }
  for (const l of L) {
    let best = -1
    for (let i = 0; i < V.length; i++) {
      const v = V[i] as Row
      if (used.has(i) || v.tripId !== l.tripId) continue
      if (best < 0 || Math.abs(v.dep - l.dep) < Math.abs((V[best] as Row).dep - l.dep)) best = i
    }
    const v = V[best]
    if (best < 0 || !v || Math.abs(v.dep - l.dep) > 12 * 3600) {
      report.legacyOnly.push(l)
      continue
    }
    used.add(best)
    const depOk = Math.abs(v.dep - l.dep) <= TOLERANCE_S
    const arrOk = v.arr == null || l.arr == null || Math.abs(v.arr - l.arr) <= TOLERANCE_S
    if (depOk && arrOk) report.matched++
    else report.timeMismatch.push({ legacy: l, v1: v })
  }
  V.forEach((v, i) => {
    if (!used.has(i)) report.v1Only.push(v)
  })
  return report
}

const fmt = (s: number | null) =>
  s == null
    ? '—'
    : new Date(s * 1000).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour12: false })

function markdown(
  summary: Record<string, unknown>,
  pairs: PairReport[],
  names: Record<string, string>,
): string {
  const bad = pairs.filter((p) => p.legacyOnly.length + p.v1Only.length + p.timeMismatch.length > 0)
  const lines = [
    '# Ferry shadow diff: /v1 vs legacy latest.json',
    '',
    '| | |',
    '|---|---|',
    ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    bad.length === 0 ? '**Within tolerance for every pair.**' : `## ${bad.length} pairs with differences`,
    '',
  ]
  for (const p of bad.slice(0, 60)) {
    lines.push(`### ${names[p.origin] ?? p.origin} → ${names[p.dest] ?? p.dest} (${p.origin} → ${p.dest})`)
    lines.push(`legacy ${p.legacy}, v1 ${p.v1}, matched ${p.matched}`)
    for (const r of p.legacyOnly.slice(0, 5))
      lines.push(`- legacy only: ${r.tripId} ${r.route} dep ${fmt(r.dep)} arr ${fmt(r.arr)}`)
    for (const r of p.v1Only.slice(0, 5))
      lines.push(`- v1 only: ${r.tripId} ${r.route} dep ${fmt(r.dep)} arr ${fmt(r.arr)}`)
    for (const m of p.timeMismatch.slice(0, 5)) {
      lines.push(
        `- time: ${m.legacy.tripId} dep ${fmt(m.legacy.dep)} vs ${fmt(m.v1.dep)}, arr ${fmt(m.legacy.arr)} vs ${fmt(m.v1.arr)}`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const legacyPath = arg('legacy')
  const dataDir = arg('data')
  const api = arg('api')
  if (!legacyPath || (!dataDir && !api)) {
    console.error(
      'usage: shadow-diff.ts --legacy latest.json (--data dir | --api url) [--at ISO] [--out dir]',
    )
    process.exit(2)
  }
  const legacy = JSON.parse(await readFile(legacyPath, 'utf8')) as LegacyFile
  const atArg = arg('at')
  const generatedAt = Date.parse(legacy.generated)
  const validTo = Date.parse(legacy.validTo)
  // The legacy app filters on the device's real now; latest.json's validFrom is written 10 h late (the legacy
  // processor's toZonedTime quirk), so it is only a sanity bound, not the window start.
  const at = atArg ? Date.parse(atArg) : Date.now()
  // The legacy file's real data horizon ends before validTo (its processor drops the last ~10 h of day 2 when run
  // in UTC, as the daily Action does), so compare only up to its last departure.
  const horizon = legacy.departures.reduce((m, d) => Math.max(m, Date.parse(d.departureTime)), 0)
  const until = Math.min(at + DAY_MS, validTo, horizon + 1000)
  if (!(until > at) || at < generatedAt - DAY_MS) {
    console.error(
      `--at ${new Date(at).toISOString()} is outside latest.json's window ${legacy.validFrom}..${legacy.validTo}`,
    )
    process.exit(2)
  }
  const v1 = api ? remoteV1(api) : inProcessV1(dataDir as string)
  const window = legacyWindow(legacy, new Date(at))
  const pairs: PairReport[] = []
  const stops = Object.keys(legacy.ferryStops).sort()
  for (const origin of stops) {
    const dests = legacy.stopConnectivity?.[origin] ?? legacy.ferryStops[origin]?.validDestinations ?? []
    for (const dest of [...dests].sort()) {
      const legacyRows = processGitHubDepartures(window, { outbound: { id: origin }, inbound: { id: dest } })
      let v1Rows = await v1(origin, dest, at, until)
      // A remote /v1 page covers less than 24 h: compare only up to its last departure.
      let limitMs = until
      if (api && v1Rows.length === 100) limitMs = (v1Rows.at(-1)?.schedDep ?? 0) * 1000
      v1Rows = v1Rows.filter((d) => d.schedDep * 1000 < limitMs + 1)
      pairs.push(comparePair(origin, dest, legacyRows, v1Rows, limitMs + 1))
    }
  }
  const sum = (f: (p: PairReport) => number) => pairs.reduce((a, p) => a + f(p), 0)
  const summary = {
    at: new Date(at).toISOString(),
    until: new Date(until).toISOString(),
    legacyHorizon: new Date(horizon).toISOString(),
    legacyGenerated: legacy.generated,
    source: api ? `api ${api}` : `data ${dataDir}`,
    pairs: pairs.length,
    pairsWithDifferences: pairs.filter(
      (p) => p.legacyOnly.length + p.v1Only.length + p.timeMismatch.length > 0,
    ).length,
    legacyDepartures: sum((p) => p.legacy),
    v1Departures: sum((p) => p.v1),
    matched: sum((p) => p.matched),
    legacyOnly: sum((p) => p.legacyOnly.length),
    v1Only: sum((p) => p.v1Only.length),
    timeMismatch: sum((p) => p.timeMismatch.length),
    v1OtherRoutes: sum((p) => p.v1OtherRoutes),
  }
  const names = Object.fromEntries(
    Object.entries(legacy.ferryStops).map(([k, v]) => [k, v.name.replace(/ ferry terminal$/i, '')]),
  )
  const outDir = arg('out')
  if (outDir) {
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'shadow-diff.json'), JSON.stringify({ summary, pairs }, null, 2))
    await writeFile(join(outDir, 'shadow-diff.md'), markdown(summary, pairs, names))
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.pairsWithDifferences === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
