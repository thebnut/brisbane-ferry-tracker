/**
 * The stop index `data/{mode}/stops.json` (StopIndexFile): display names by stop key, and for stations which
 * platform stop ids belong to them with each platform's code (live platform changes, bft-train #42).
 * Cached per manifest generation, since the path is rewritten in place each publish.
 */
import type { Mode, RtStopUpdate, StopIndexFile } from '@bft/core'
import { readJson } from './data/source.ts'
import type { StaticStore } from './data/static-store.ts'
import { awaitFlight, DeadlineError, type Flight, flight, isDead } from './deadline.ts'

export interface Stations {
  /** stop key → display name (StopRef.name is optional on downstream stops, so names come from here) */
  names: Map<string, string>
  /** stationKey → (platform stop id → platform code) */
  platforms: Map<string, Map<string, string | undefined>>
  /** platform stop id → { stationKey, code } */
  byStop: Map<string, { stationKey: string; code: string | undefined }>
  /** Set-down-only stop key → where to board instead (StopIndexEntry.boardAt). */
  boardAt: Map<string, Array<{ key: string; name: string }>>
}

const cache = new Map<string, Flight<Stations | null>>()

/** A read still pending at the store's load deadline is replaced, and its waiters fail instead of hanging. */
export function stationsFor(store: StaticStore, mode: Mode, generation: string): Promise<Stations | null> {
  const now = store.now
  const deadlineMs = store.loadDeadlineMs
  const k = `${mode}/${generation}`
  let f = cache.get(k)
  if (!f || isDead(f, now(), deadlineMs)) {
    const load = flight(
      readJson(store.source, `data/${mode}/stops.json`).then((raw) =>
        raw ? buildStations(raw as StopIndexFile) : null,
      ),
      now(),
    )
    load.p.catch(() => {
      if (cache.get(k) === load) cache.delete(k)
    })
    if (cache.size > 8) cache.clear()
    cache.set(k, load)
    f = load
  }
  const shared = f
  return awaitFlight(shared, now(), deadlineMs, `data/${mode}/stops.json`).catch((e: unknown) => {
    if (e instanceof DeadlineError && cache.get(k) === shared) cache.delete(k)
    throw e
  })
}

export function buildStations(file: StopIndexFile): Stations {
  const platforms = new Map<string, Map<string, string | undefined>>()
  const byStop = new Map<string, { stationKey: string; code: string | undefined }>()
  const names = new Map<string, string>()
  const boardAt = new Map<string, Array<{ key: string; name: string }>>()
  for (const s of file.stops) {
    names.set(s.key, s.name)
    if (s.boardAt) boardAt.set(s.key, s.boardAt)
    const m = new Map<string, string | undefined>()
    for (const p of s.platforms ?? []) {
      m.set(p.id, p.code)
      byStop.set(p.id, { stationKey: s.key, code: p.code })
    }
    platforms.set(s.key, m)
  }
  return { names, platforms, byStop, boardAt }
}

/**
 * Platform fields for one trip stop: the timetabled platform, or on a live change (the RT update for this stop
 * occurrence names another platform of the same station) the new platform plus `scheduledPlatform`.
 */
export function tripStopPlatform(
  stations: Stations | null,
  staticStopId: string,
  update: RtStopUpdate | undefined,
): { platform?: string | null; scheduledPlatform?: string; stationKey?: string } {
  const own = stations?.byStop.get(staticStopId)
  if (!own) return {}
  const out: { platform?: string | null; scheduledPlatform?: string; stationKey?: string } = {
    platform: own.code ?? null,
    stationKey: own.stationKey,
  }
  const rtStop = update?.stopId
  if (rtStop && rtStop !== staticStopId) {
    const moved = stations?.byStop.get(rtStop)
    if (moved && moved.stationKey === own.stationKey && moved.code !== own.code) {
      out.platform = moved.code ?? null
      if (own.code) out.scheduledPlatform = own.code
    }
  }
  return out
}
