/**
 * Stop keys (ADR-0007): train keys by parent station slug (platform is a field), every other mode by stop_id.
 * Slugs come from names, so they survive timetable versions that rotate platform ids.
 */
import type { Mode } from '@bft/core'
import { slugify } from '@bft/core'
import type { Feed, StopRow } from '../feed/load.ts'

export interface StopKeys {
  /** keyOf(mode, stopIdx) → stop key for that mode. */
  keyOf(mode: Mode, stopIdx: number): string
  /** For a train key, the station row (parent, or the platform itself when it has no parent). */
  stationOf(key: string): StopRow | undefined
}

/** Stop rows served by train trips (any service), so slugs only compete among rail stations. */
function trainStopRows(feed: Feed): Set<number> {
  const out = new Set<number>()
  for (const t of feed.trips) {
    if (feed.routes.get(t.routeId)?.mode !== 'train') continue
    for (let r = t.start; r < t.start + t.count; r++) out.add(feed.stopTimes.stop[r] as number)
  }
  return out
}

export function buildStopKeys(feed: Feed): StopKeys {
  // Train: one slug per station row. Two different stations with the same slug get the station id appended,
  // deterministically (sorted by id) so the first keeps the plain slug.
  const stationIdOf = (s: StopRow): string => (s.parent ? s.parent : s.id)
  const bySlug = new Map<string, string[]>()
  const stationIds = new Set<string>()
  for (const i of trainStopRows(feed)) stationIds.add(stationIdOf(feed.stops[i] as StopRow))
  for (const id of [...stationIds].sort()) {
    const row = feed.stops[feed.stopIndex.get(id) as number] as StopRow
    const slug = slugify(row.name) || slugify(id)
    const list = bySlug.get(slug) ?? []
    list.push(id)
    bySlug.set(slug, list)
  }
  const slugOfStation = new Map<string, string>()
  const stationOfSlug = new Map<string, StopRow>()
  for (const [slug, ids] of bySlug) {
    ids.forEach((id, i) => {
      const key = i === 0 ? slug : `${slug}-${slugify(id)}`
      slugOfStation.set(id, key)
      stationOfSlug.set(key, feed.stops[feed.stopIndex.get(id) as number] as StopRow)
    })
  }
  const trainKey: string[] = feed.stops.map((s) => slugOfStation.get(stationIdOf(s)) ?? s.id)

  return {
    keyOf: (mode, i) => (mode === 'train' ? (trainKey[i] as string) : (feed.stops[i] as StopRow).id),
    stationOf: (key) => stationOfSlug.get(key),
  }
}
