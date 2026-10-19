/**
 * Two validator classes (transit-architecture.md §3.2, ADR-0002):
 *  - structural corruption fails closed: the build stops and the previous generation keeps serving
 *    (missing or unparseable files and referential breaks are raised by loadFeed; feed_end_date and the golden
 *    facts are checked here; the MobilityData validator runs in CI, see scripts/gtfs-validator-report.ts)
 *  - plausible service changes are quarantined: published under manifest.staging.json until accepted
 */
import type { CalendarDateRow, CalendarRow, GenerationIndex, Mode } from '@bft/core'
import { addDays } from '@bft/core'

export class StructuralFailure extends Error {
  constructor(readonly problems: string[]) {
    super(`structural validation failed:\n- ${problems.join('\n- ')}`)
  }
}

export function checkFeedEndDate(feedEndDate: string | undefined, today: string, minDays = 7): string[] {
  if (!feedEndDate) return ['feed_info.txt has no feed_end_date']
  const min = addDays(today, minDays)
  return feedEndDate < min ? [`feed_end_date ${feedEndDate} is before today+${minDays} (${min})`] : []
}

/** The service dates a feed claims to cover, inclusive YYYYMMDD ('' when the feed gives no bound). */
export interface FeedCoverage {
  start: string
  end: string
}

const YMD = /^\d{8}$/
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

/**
 * feed_info's feed_start_date/feed_end_date, else the earliest/latest date calendar.txt or calendar_dates.txt gives
 * service on. A new TransLink feed starts on the day it is published (generation 20261020-…), so D−1 of the build
 * window lies before it (issue #93).
 */
export function feedCoverage(
  feedInfo: { startDate: string; endDate: string } | null,
  calendar: CalendarRow[],
  calendarDates: CalendarDateRow[],
): FeedCoverage {
  const starts: string[] = []
  const ends: string[] = []
  for (const r of calendar) {
    if (!WEEKDAYS.some((d) => r[d] === '1')) continue
    if (YMD.test(r.start_date)) starts.push(r.start_date)
    if (YMD.test(r.end_date)) ends.push(r.end_date)
  }
  for (const r of calendarDates)
    if (r.exception_type === '1' && YMD.test(r.date)) {
      starts.push(r.date)
      ends.push(r.date)
    }
  const pick = (declared: string | undefined, found: string[], earliest: boolean) =>
    declared && YMD.test(declared) ? declared : (found.sort()[earliest ? 0 : found.length - 1] ?? '')
  return { start: pick(feedInfo?.startDate, starts, true), end: pick(feedInfo?.endDate, ends, false) }
}

/** Dates outside the feed's validity: before its start or after its end. */
export function uncoveredDates(dates: string[], c: FeedCoverage): string[] {
  return dates.filter((d) => (c.start && d < c.start) || (c.end && d > c.end))
}

/**
 * Fails closed when the feed doesn't cover service date D (it starts later or has already ended): today's boards
 * would be empty. Only dates before D, i.e. D−1, may be uncovered and dropped from the window.
 */
export function checkCoversToday(c: FeedCoverage, today: string): string[] {
  if (c.start && today < c.start)
    return [`feed starts ${c.start}, after service date ${today}: it doesn't cover today`]
  if (c.end && today > c.end)
    return [`feed ended ${c.end}, before service date ${today}: it doesn't cover today`]
  return []
}

export interface GoldenFact {
  mode: Mode
  key: string
  label: string
  /** Minimum number of service dates in the window with at least one event. */
  minDays: number
}

/**
 * Facts the real SEQ feed must satisfy (the places the golden fixtures cover). A feed that drops one of these
 * entirely is far more likely corrupt than a real timetable change. Only applied to TransLink feeds.
 */
export const SEQ_GOLDEN_FACTS: GoldenFact[] = [
  { mode: 'ferry', key: '317584', label: 'Bulimba ferry terminal', minDays: 5 },
  { mode: 'ferry', key: '317590', label: 'Riverside ferry terminal', minDays: 5 },
  { mode: 'train', key: 'central', label: 'Central station', minDays: 5 },
  { mode: 'train', key: 'bowen-hills', label: 'Bowen Hills station', minDays: 5 },
  { mode: 'train', key: 'domestic-airport', label: 'Domestic Airport station', minDays: 5 },
  { mode: 'bus', key: '10802', label: 'Cultural Centre busway platform 1', minDays: 5 },
]

/** `served(mode, date, key)`: whether the build has a stop-day for that stop on that date. */
export function checkGoldenFacts(
  served: (mode: Mode, date: string, key: string) => boolean,
  dates: string[],
  facts = SEQ_GOLDEN_FACTS,
): string[] {
  const out: string[] = []
  for (const f of facts) {
    const days = dates.filter((d) => served(f.mode, d, f.key)).length
    if (days < f.minDays)
      out.push(`golden: ${f.label} (${f.mode} ${f.key}) has service on ${days} days, expected ≥ ${f.minDays}`)
  }
  return out
}

export interface QuarantineInput {
  mode: Mode
  index: GenerationIndex
  previous: GenerationIndex | null
  /** Station-like keys checked for zero service (train stations, ferry terminals, tram stops). */
  stationKeys?: Set<string>
  /** True when calendar_dates removes a service of some trip serving `key` on `date` (a planned closure). */
  closureExplained: (key: string, date: string) => boolean
  /** Allowed relative change in trip count per service date vs the previous generation. */
  tripTolerance?: number
  /**
   * The new feed's validity. Dates outside it aren't compared: the new feed can't have service there, so a −100%
   * drop or a station "losing" service is the feed boundary, not a timetable change. The build reports them instead.
   */
  coverage?: FeedCoverage
}

/** Reasons to quarantine one mode's new generation; empty when it can go live. */
export function quarantineReasons(q: QuarantineInput): string[] {
  const reasons: string[] = []
  const tol = q.tripTolerance ?? 0.2
  const stats = q.index.stats ?? {}
  const prevStats = q.previous?.stats ?? {}
  const skipped = new Set(q.coverage ? uncoveredDates(q.index.serviceDates, q.coverage) : [])
  const compared = q.index.serviceDates.filter((d) => !skipped.has(d))
  for (const date of compared) {
    const now = stats[date]
    const before = prevStats[date]
    if (!now || !before || before.trips === 0) continue
    const change = (now.trips - before.trips) / before.trips
    if (Math.abs(change) > tol)
      reasons.push(
        `${q.mode} ${date}: trip count ${before.trips} → ${now.trips} (${change > 0 ? '+' : ''}${Math.round(change * 100)}%, limit ±${Math.round(tol * 100)}%)`,
      )
  }

  if (q.stationKeys) {
    const served = (idx: GenerationIndex | null, date: string) =>
      idx?.blobs[date] ? new Set(Object.keys(idx.blobs[date])) : null
    for (const date of compared) {
      const today = served(q.index, date) ?? new Set<string>()
      // Expected service: the previous generation served it on this date. (Comparing weekdays within the window
      // was tried and rejected: SEQ trackwork closes lines on weekends through separate calendar services, not
      // calendar_dates, so it quarantined train most weekends on the 17 Oct 2026 feed.)
      const expected = new Set<string>(served(q.previous, date) ?? [])
      for (const key of [...expected].sort()) {
        if (!q.stationKeys.has(key) || today.has(key)) continue
        if (q.closureExplained(key, date)) continue
        reasons.push(`${q.mode} ${date}: ${key} has no service and calendar_dates doesn't explain it`)
      }
    }
  }
  return reasons
}
