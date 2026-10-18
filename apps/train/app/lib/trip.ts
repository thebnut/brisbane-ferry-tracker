/**
 * Service detail view model (T-Detail): one row per station along the train's corridor, including stations an express
 * runs through, with separate arrival and departure times, the platform per stop (and platform changes), and the
 * train's position as a fractional row index for the moving capsule.
 */
import type { TripResponse, TripStop } from '@bft/core/contract'
import { delayText, formatClock, type TimelineKind, type TimelineStop } from '@bft/ui'
import { cleanStopName } from './names.ts'
import { corridorFor, platformOf, stationByKey, stationKeyOfStop } from './network.ts'

export interface TripRow extends TimelineStop {
  stationKey: string
  stop: TripStop | null
}

const effArr = (s: TripStop) => s.estArr ?? s.schedArr
const effDep = (s: TripStop) => s.estDep ?? s.schedDep

/** Platform of a trip stop: the API's field when present, else from the platform stop id. */
export function stopPlatform(s: TripStop): { platform: string | null; scheduled: string | null } {
  const platform = s.platform !== undefined ? s.platform : platformOf(s.stopId)?.code || null
  return { platform, scheduled: s.scheduledPlatform ?? null }
}

export function buildTimeline(
  trip: TripResponse,
  nowS: number,
  from: string | null,
  to: string | null,
): { rows: TripRow[]; position: number | null; positionLabel: string | null } {
  const calls = trip.stops.map((s) => s.stationKey ?? stationKeyOfStop(s.stopId) ?? s.stopId)
  const corridor = corridorFor(calls)
  const rows: TripRow[] = []
  let ci = 0
  for (const key of corridor) {
    const stop = calls[ci] === key ? (trip.stops[ci] as TripStop) : null
    if (stop) ci++
    const name = stop?.name ?? stationByKey(key)?.name ?? cleanStopName(key)
    if (!stop) {
      rows.push({
        id: `pass:${key}`,
        stationKey: key,
        stop: null,
        name,
        kind: 'skip',
        note: 'Passes, no stop',
      })
      continue
    }
    const last = rows.length === corridor.length - 1 || ci === trip.stops.length
    const dep = effDep(stop)
    const arr = effArr(stop)
    const { platform, scheduled } = stopPlatform(stop)
    const cancelled = stop.status === 'cancelled'
    const skipped = stop.status === 'skipped'
    const past = (dep ?? arr ?? 0) < nowS - 30
    let kind: TimelineKind = past ? 'passed' : 'stop'
    if (key === to && !past) kind = 'you'
    if (last && !past) kind = key === to ? 'you' : 'terminus'
    const parts: string[] = []
    if (skipped) parts.push('Not stopping (changed today)')
    else if (past) parts.push(last ? 'Arrived' : 'Departed')
    if (key === from && !past) parts.push('Your station')
    if (key === to) parts.push('Your stop')
    if (platform && !skipped)
      parts.push(scheduled ? `platform ${platform} (changed from ${scheduled})` : `platform ${platform}`)
    if (last && !past) parts.push('Terminates')
    const note = parts.join(' · ')
    rows.push({
      id: `${stop.stopSequence}:${key}`,
      stationKey: key,
      stop,
      name,
      kind: skipped ? 'skip' : kind,
      note: note ? note.charAt(0).toUpperCase() + note.slice(1) : undefined,
      arr: stop.schedArr != null && ci > 1 ? formatClock(arr as number) : null,
      dep: !last && stop.schedDep != null ? formatClock(dep as number) : null,
      delay: stop.status === 'live' ? delayText(stop.schedDep ?? stop.schedArr ?? 0, dep ?? arr) : null,
      cancelled,
    })
  }
  return { rows, ...positionOf(rows, nowS) }
}

/** Fractional row index of the train from the stop times (the capsule), or null before the run or after it. */
export function positionOf(
  rows: TripRow[],
  nowS: number,
): { position: number | null; positionLabel: string | null } {
  const stops = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.stop && x.r.stop.status !== 'skipped' && x.r.stop.status !== 'cancelled')
  if (stops.length < 2) return { position: null, positionLabel: null }
  const first = stops[0] as (typeof stops)[number]
  const last = stops[stops.length - 1] as (typeof stops)[number]
  const t = (x: (typeof stops)[number], which: 'arr' | 'dep') => {
    const s = x.r.stop as TripStop
    return which === 'arr' ? (effArr(s) ?? effDep(s) ?? 0) : (effDep(s) ?? effArr(s) ?? 0)
  }
  if (nowS < t(first, 'dep') - 15 * 60 || nowS > t(last, 'arr') + 60)
    return { position: null, positionLabel: null }
  if (nowS <= t(first, 'dep')) return { position: first.i, positionLabel: `Waiting at ${first.r.name}` }
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k] as (typeof stops)[number]
    const b = stops[k + 1] as (typeof stops)[number]
    if (nowS <= t(a, 'dep')) return { position: a.i, positionLabel: `At ${a.r.name}` }
    if (nowS < t(b, 'arr')) {
      const f = (nowS - t(a, 'dep')) / Math.max(1, t(b, 'arr') - t(a, 'dep'))
      return {
        position: a.i + f * (b.i - a.i),
        positionLabel: `Between ${a.r.name} and ${b.r.name}`,
      }
    }
  }
  return { position: last.i, positionLabel: `At ${last.r.name}` }
}

const OCCUPANCY: Record<string, { text: string; bars: number }> = {
  EMPTY: { text: 'Empty', bars: 0 },
  MANY_SEATS_AVAILABLE: { text: 'Many seats', bars: 1 },
  FEW_SEATS_AVAILABLE: { text: 'Few seats', bars: 2 },
  STANDING_ROOM_ONLY: { text: 'Standing room', bars: 3 },
  CRUSHED_STANDING_ROOM_ONLY: { text: 'Very full', bars: 4 },
  FULL: { text: 'Full', bars: 4 },
  NOT_ACCEPTING_PASSENGERS: { text: 'Not taking passengers', bars: 4 },
}
export const occupancyOf = (v: string | undefined) => (v ? (OCCUPANCY[v] ?? null) : null)

const STATUS: Record<string, string> = {
  INCOMING_AT: 'Arriving',
  STOPPED_AT: 'At platform',
  IN_TRANSIT_TO: 'In transit',
}
export const vehicleStatusText = (v: string | undefined) => (v ? (STATUS[v] ?? null) : null)
