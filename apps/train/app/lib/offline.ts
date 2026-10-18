/**
 * Offline full day: for each favourite, fetch the rest of today's timetable (paged with `at`, 100 rows a page, the
 * API's maximum) and keep it in localStorage, so the board still works with no signal ("Offline · scheduled").
 * Runs after the page is idle, at most once an hour per favourite, and never on a metered "save data" connection.
 */
import type { Departure } from '@bft/core/contract'
import type { ApiFetcher } from './api.ts'
import { fetchDepartures } from './api.ts'
import { type Favourite, type OfflineDay, pruneOffline, readOfflineDay, writeOfflineDay } from './storage.ts'

const PAGE = 100
const MAX_PAGES = 8
const REFRESH_MS = 60 * 60 * 1000

/** End of the current service day: 03:00 Brisbane tomorrow (Brisbane is UTC+10 all year). */
export function serviceDayEnd(nowMs: number): number {
  const brisbane = new Date(nowMs + 10 * 3600 * 1000)
  const end =
    Date.UTC(brisbane.getUTCFullYear(), brisbane.getUTCMonth(), brisbane.getUTCDate(), 3) - 10 * 3600 * 1000
  return Math.floor((end > nowMs ? end : end + 24 * 3600 * 1000) / 1000)
}

/** The rest of the service day for one trip, paged. Rows are kept as the API sent them. */
export async function fetchRestOfDay(fetcher: ApiFetcher, f: Favourite, nowMs: number): Promise<OfflineDay> {
  const end = serviceDayEnd(nowMs)
  const rows: Departure[] = []
  const seen = new Set<string>()
  let at: number | null = null
  let serviceDate = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchDepartures(fetcher, f.from, f.to, { limit: PAGE, at })
    serviceDate ||= res.serviceDates.at(-1) ?? ''
    let added = 0
    for (const d of res.departures) {
      const k = `${d.tripInstance}:${d.stopSequence}`
      if (seen.has(k) || d.schedDep > end) continue
      seen.add(k)
      rows.push(d)
      added++
    }
    const last = res.departures.at(-1)
    if (!last || res.departures.length < PAGE || added === 0 || last.schedDep > end) break
    at = last.schedDep + 1
  }
  rows.sort((a, b) => a.schedDep - b.schedDep)
  return { savedAt: nowMs, serviceDate, from: f.from, to: f.to, departures: rows }
}

export interface PrefetchResult {
  saved: number
  bytes: number
}

/** Save today's timetable for every favourite that needs it. */
export async function prefetchFavourites(
  fetcher: ApiFetcher,
  favourites: Favourite[],
  nowMs = Date.now(),
): Promise<PrefetchResult> {
  pruneOffline(favourites)
  let saved = 0
  let bytes = 0
  for (const f of favourites) {
    const have = readOfflineDay(f.from, f.to)
    if (have && nowMs - have.savedAt < REFRESH_MS && serviceDayEnd(have.savedAt) === serviceDayEnd(nowMs))
      continue
    try {
      const day = await fetchRestOfDay(fetcher, f, nowMs)
      writeOfflineDay(day)
      saved++
      bytes += JSON.stringify(day).length
    } catch {
      // Offline or the API is down: keep whatever copy we have.
    }
  }
  return { saved, bytes }
}

/** Should we prefetch now? Not offline, and not when the user asked to save data. */
export function canPrefetch(): boolean {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !c?.saveData
}
