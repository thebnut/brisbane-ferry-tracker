/**
 * Two validator classes (transit-architecture.md §3.2, ADR-0002):
 *  - structural corruption fails closed: the build stops and the previous generation keeps serving
 *    (missing or unparseable files and referential breaks are raised by loadFeed; feed_end_date and the golden
 *    facts are checked here; the MobilityData validator runs in CI, see scripts/gtfs-validator-report.ts)
 *  - plausible service changes are quarantined: published under manifest.staging.json until accepted
 */
import type { CalendarDateRow, CalendarRow, GenerationIndex, Mode, ServiceCalendar } from '@bft/core'
import { addDays, dayOfWeek } from '@bft/core'

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
 * window lies before it (issue #93). In a build the end is always feed_info's: loadFeed and checkFeedEndDate require
 * feed_end_date (fail closed), and that requirement is deliberately not relaxed to the calendar fallback.
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
  /** Minimum number of dates, from the window's first date to the feed's end, the landmark is served on. */
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

/**
 * A closure of a golden landmark that a person has checked against the operator's notice, reviewed like code. It
 * only vouches for dates the feed's own calendar already closes (see checkGoldenLandmarks); it can't excuse a
 * missing stop, a lost stop-day or a landmark that never reopens.
 */
export interface AttestedClosure {
  mode: Mode
  key: string
  /** Inclusive YYYYMMDD range. */
  from: string
  to: string
  source: string
}

/**
 * Bulimba ferry terminal closed 9 Nov–13 Dec 2026 (TransLink notice 1175181). The feed closes its weekdays only by
 * starting the weekday services on 14 Dec, which a source can't tell apart from deleted stop_times; its weekend
 * closures are calendar_dates removals and need no attestation.
 */
export const ATTESTED_CLOSURES: AttestedClosure[] = [
  {
    mode: 'ferry',
    key: '317584',
    from: '20261109',
    to: '20261213',
    source: 'https://translink.com.au/updates/1175181',
  },
]

/** What the whole feed says about one landmark, read independently of the build's window. */
export interface LandmarkEvidence {
  fact: GoldenFact
  /** Services with a trip (anywhere in the feed, any date) that boards at the landmark (what makes a stop-day). */
  services: Set<string>
  /** Routes of those trips. */
  routes: Set<string>
  /** Whether the build has a stop-day for the landmark on this window date. */
  served: (date: string) => boolean
  /** Whether a trip of one of `routes` runs on this window date, whatever stops it calls at. */
  routeRuns: (date: string) => boolean
  /**
   * The live generation's view of this date when it was built from a different feed: 'served' or 'unserved', or
   * undefined when there is no such generation or it doesn't cover the date.
   */
  previous?: (date: string) => 'served' | 'unserved' | undefined
}

export interface LandmarkCalendar {
  calendar: ServiceCalendar
  calendarRows: CalendarRow[]
  /** The build window's service dates (D−1 dropped when the feed doesn't cover it). */
  windowDates: string[]
  /** Last service date of the feed (feed_end_date). */
  feedEnd: string
  /** Reviewed closures (default ATTESTED_CLOSURES). */
  attested?: AttestedClosure[]
  /** Receives one summary line per landmark (for the build log). */
  note?: (line: string) => void
}

/**
 * Golden landmarks, closure-aware (structural). A landmark fails when:
 *  - it is served on fewer than `minDays` dates from the window's start to the feed's end (removed, or the feed or
 *    its service is truncated);
 *  - a service boarding at it is active on a window date but the build has no stop-day there;
 *  - it is unserved on a window date it was expected (one of its routes runs that day, or it is served on that
 *    weekday elsewhere in the feed) and the calendar doesn't schedule a closure there: no service boarding at it has
 *    that weekday in calendar.txt yet excludes the date (start_date after it, end_date before it, or a type-2
 *    exception), or the landmark is never served again afterwards;
 *  - fewer than `minDays` window dates are served or corroborated closures, while some scheduled closure dates are
 *    not corroborated (the old window rule, with only proven closures counted as served);
 *  - a scheduled closure date the live generation (from a different feed) served is not corroborated.
 * A closure date is corroborated only by evidence about that date that deleting stop_times can't produce: a type-2
 * removal of a landmark service that would otherwise run, the live generation from a different feed having no
 * stop-day there, or an ATTESTED_CLOSURES entry. A closure shown only by service boundaries (a later start_date, an
 * earlier end_date) is indistinguishable in the source from deleted stop_times rows, so it isn't corroborated.
 */
export function checkGoldenLandmarks(landmarks: LandmarkEvidence[], c: LandmarkCalendar): string[] {
  const out: string[] = []
  const first = c.windowDates[0]
  if (!first) return out
  const attested = c.attested ?? ATTESTED_CLOSURES
  const rowOf = new Map(c.calendarRows.map((r) => [r.service_id, r]))
  const fieldOf = (date: string) => WEEKDAYS[(dayOfWeek(date) + 6) % 7] as (typeof WEEKDAYS)[number]
  for (const l of landmarks) {
    const name = `${l.fact.label} (${l.fact.mode} ${l.fact.key})`
    const servedOn = (date: string) => [...c.calendar.activeServices(date)].some((s) => l.services.has(s))
    const operating: string[] = []
    for (let d = first; d <= c.feedEnd; d = addDays(d, 1)) if (servedOn(d)) operating.push(d)
    if (operating.length < l.fact.minDays) {
      out.push(
        `golden: ${name} has service on ${operating.length} dates from ${first} to the feed end ${c.feedEnd}, expected ≥ ${l.fact.minDays}`,
      )
      continue
    }
    const weekdays = new Set(operating.map(dayOfWeek))
    /** A landmark service whose calendar.txt row runs on that weekday but excludes the date. */
    const closedBy = (date: string) =>
      [...l.services].find((s) => {
        const r = rowOf.get(s)
        if (r?.[fieldOf(date)] !== '1') return false
        return date < r.start_date || date > r.end_date || c.calendar.isExplicitlyRemoved(s, date)
      })
    /** Evidence about this date alone that it is closed. */
    const evidence = (date: string): string | undefined => {
      const removed = [...l.services].find((s) => {
        const r = rowOf.get(s)
        return (
          r?.[fieldOf(date)] === '1' &&
          r.start_date <= date &&
          date <= r.end_date &&
          c.calendar.isExplicitlyRemoved(s, date)
        )
      })
      if (removed) return `${removed} removed`
      const a = attested.find(
        (x) => x.mode === l.fact.mode && x.key === l.fact.key && x.from <= date && date <= x.to,
      )
      if (a) return `attested ${a.source}`
      return l.previous?.(date) === 'unserved' ? 'previous generation' : undefined
    }
    const served = c.windowDates.filter(l.served)
    const corroborated: string[] = []
    const unproven: string[] = []
    for (const date of c.windowDates) {
      if (l.served(date)) continue
      if (servedOn(date)) {
        out.push(
          `golden: ${name} has a service boarding at it on ${date}, but the build has no stop-day there`,
        )
        continue
      }
      if (!l.routeRuns(date) && !weekdays.has(dayOfWeek(date))) continue
      const by = closedBy(date)
      if (!by) {
        out.push(`golden: ${name} has no service on ${date} and the calendar doesn't schedule a closure`)
        continue
      }
      if (!operating.some((d) => d > date)) {
        out.push(
          `golden: ${name} has no service on ${date} and none after it: a closure must reopen within the feed`,
        )
        continue
      }
      const why = evidence(date)
      if (why) corroborated.push(`${date} (${by}; ${why})`)
      else if (l.previous?.(date) === 'served')
        out.push(
          `golden: ${name} has no service on ${date}, which the live generation served: ${by}'s calendar excludes ` +
            'it, but no calendar_dates removal or attested closure confirms it',
        )
      else unproven.push(`${date} (${by})`)
    }
    if (unproven.length && served.length + corroborated.length < l.fact.minDays)
      out.push(
        `golden: ${name} has ${served.length} served and ${corroborated.length} confirmed closed window dates, ` +
          `expected ≥ ${l.fact.minDays}; unconfirmed closure on ${unproven.join(', ')} (only service boundaries, ` +
          'which deleted stop_times would also produce: a calendar_dates removal, the live generation from an ' +
          'earlier feed, or an ATTESTED_CLOSURES entry confirms a date)',
      )
    c.note?.(
      `golden: ${name}: ${operating.length} service dates to ${c.feedEnd}, ` +
        `${served.length}/${c.windowDates.length} window dates served` +
        (corroborated.length ? `, closure confirmed on ${corroborated.join(', ')}` : '') +
        (unproven.length ? `, closure unconfirmed on ${unproven.join(', ')}` : ''),
    )
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
