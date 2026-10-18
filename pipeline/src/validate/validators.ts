/**
 * Two validator classes (transit-architecture.md §3.2, ADR-0002):
 *  - structural corruption fails closed: the build stops and the previous generation keeps serving
 *    (missing or unparseable files and referential breaks are raised by loadFeed; feed_end_date and the golden
 *    facts are checked here; the MobilityData validator runs in CI, see scripts/gtfs-validator-report.ts)
 *  - plausible service changes are quarantined: published under manifest.staging.json until accepted
 */
import type { GenerationIndex, Mode } from '@bft/core'
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

export function checkGoldenFacts(
  indexes: Partial<Record<Mode, GenerationIndex>>,
  facts = SEQ_GOLDEN_FACTS,
): string[] {
  const out: string[] = []
  for (const f of facts) {
    const idx = indexes[f.mode]
    if (!idx) continue
    const days = Object.values(idx.blobs).filter((m) => f.key in m).length
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
}

/** Reasons to quarantine one mode's new generation; empty when it can go live. */
export function quarantineReasons(q: QuarantineInput): string[] {
  const reasons: string[] = []
  const tol = q.tripTolerance ?? 0.2
  const stats = q.index.stats ?? {}
  const prevStats = q.previous?.stats ?? {}
  for (const date of q.index.serviceDates) {
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
    const dates = q.index.serviceDates
    for (const date of dates) {
      const today = served(q.index, date) ?? new Set<string>()
      // Expected service: the previous generation served it on this date, or this generation serves it on
      // another date in the window with the same weekday.
      const expected = new Set<string>(served(q.previous, date) ?? [])
      for (const other of dates) {
        if (other === date || dayOfWeek(other) !== dayOfWeek(date)) continue
        for (const k of served(q.index, other) ?? []) expected.add(k)
      }
      for (const key of [...expected].sort()) {
        if (!q.stationKeys.has(key) || today.has(key)) continue
        if (q.closureExplained(key, date)) continue
        reasons.push(`${q.mode} ${date}: ${key} has no service and calendar_dates doesn't explain it`)
      }
    }
  }
  return reasons
}
