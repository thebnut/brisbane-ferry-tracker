/**
 * The stop index `data/{mode}/stops.json` (StopIndexFile): display names by stop key, and for stations which
 * platform stop ids belong to them with each platform's code (live platform changes, bft-train #42).
 * Cached per manifest generation, since the path is rewritten in place each publish.
 */
import type { Mode, RtStopUpdate, StopIndexFile } from '@bft/core'
import { readJson } from './data/source.ts'
import type { StaticStore } from './data/static-store.ts'

export interface Stations {
  /** stop key → display name (StopRef.name is optional on downstream stops, so names come from here) */
  names: Map<string, string>
  /** stationKey → (platform stop id → platform code) */
  platforms: Map<string, Map<string, string | undefined>>
  /** platform stop id → { stationKey, code } */
  byStop: Map<string, { stationKey: string; code: string | undefined }>
}

const cache = new Map<string, Promise<Stations | null>>()

export function stationsFor(store: StaticStore, mode: Mode, generation: string): Promise<Stations | null> {
  const k = `${mode}/${generation}`
  let p = cache.get(k)
  if (!p) {
    p = readJson(store.source, `data/${mode}/stops.json`).then((raw) =>
      raw ? buildStations(raw as StopIndexFile) : null,
    )
    p.catch(() => cache.delete(k))
    if (cache.size > 8) cache.clear()
    cache.set(k, p)
  }
  return p
}

export function buildStations(file: StopIndexFile): Stations {
  const platforms = new Map<string, Map<string, string | undefined>>()
  const byStop = new Map<string, { stationKey: string; code: string | undefined }>()
  const names = new Map<string, string>()
  for (const s of file.stops) {
    names.set(s.key, s.name)
    const m = new Map<string, string | undefined>()
    for (const p of s.platforms ?? []) {
      m.set(p.id, p.code)
      byStop.set(p.id, { stationKey: s.key, code: p.code })
    }
    platforms.set(s.key, m)
  }
  return { names, platforms, byStop }
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
