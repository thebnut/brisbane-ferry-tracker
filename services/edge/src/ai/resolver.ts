/**
 * Fuzzy stop resolver for /v1/ask and the search_stops tool: uFuzzy over each mode's stop index
 * (data/{mode}/stops.json, ADR-0004), exact matching on bus stop numbers.
 *
 * For /v1/ask, bus stops that are one place to a rider (a busway station's platforms, "Cultural Centre station,
 * platform 1/2/3", or same-named stops) resolve as one candidate carrying every stop key (R11-A1). The bus index has
 * no parent_station, so places come from names: the same name once a platform or stop suffix is removed, and every
 * stop within PLACE_RADIUS_M of the first. Train keys are already stations; ferry terminals are single stops.
 */

import {
  haversine,
  type Mode,
  type StopCandidate,
  type StopIndexEntry,
  type StopIndexFile,
  type StopResolver,
} from '@bft/core'
import uFuzzy from '@leeoniya/ufuzzy'
import { readJson } from '../data/source.ts'
import type { StaticStore } from '../data/static-store.ts'

export const ASK_MODES: Mode[] = ['ferry', 'train', 'bus']

interface ModeIndex {
  mode: Mode
  stops: StopIndexEntry[]
  haystack: string[]
  /** haystack with spaces and punctuation removed, for the no-space fallback ("southbank" → South Bank). */
  compact: string[]
  byCode: Map<string, number>
  /** stop index → its place (several stops), for the stops that share one. */
  placeOf: Map<number, Place>
}

interface Place {
  name: string
  /** Stop indexes, in display order; the first is the place's key. */
  members: number[]
  /** Platform or stop suffix (lowercase, "2", "1e", "d") → the stops carrying it, so a question can name one. */
  platforms: Map<string, number[]>
}

/** Stops further apart than this are never one place, whatever their names. */
export const PLACE_RADIUS_M = 400

/**
 * A platform or stop suffix: "Cultural Centre station, platform 2", "King George Square, 1a", "Strathpine bus
 * station, stop D", "Sandgate Rd at Nundah, stop 3". Compound ones ("stop 28/1") are kept whole.
 */
const STATION_PART = /^(.+?),\s*(?:(?:platform|stop|bay)\s+)?(\d{1,3}[a-z]?|[a-z])(\s*\([^)]*\))?$/i

/** The place a stop name belongs to: the name without its platform or stop suffix. */
export const placeName = (name: string): string => {
  const m = STATION_PART.exec(name.trim())
  return m ? `${m[1]}${m[3] ?? ''}` : name.trim()
}

const platformOf = (name: string): string | undefined => STATION_PART.exec(name.trim())?.[2]?.toLowerCase()

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare

function buildPlaces(stops: StopIndexEntry[]): Map<number, Place> {
  const byName = new Map<string, number[]>()
  stops.forEach((s, i) => {
    const k = placeName(s.name).toLowerCase()
    const list = byName.get(k)
    if (list) list.push(i)
    else byName.set(k, [i])
  })
  const out = new Map<number, Place>()
  for (const list of byName.values()) {
    if (list.length < 2) continue
    // A stop joins a cluster only within PLACE_RADIUS_M of every stop already in it, so no two stops of a place are
    // further apart than that (whatever the input order), and same-named places across town stay apart.
    const clusters: number[][] = []
    for (const i of list) {
      const s = stops[i] as StopIndexEntry
      const home = clusters.find((c) =>
        c.every((j) => {
          const a = stops[j] as StopIndexEntry
          return haversine(a.lat, a.lon, s.lat, s.lon) <= PLACE_RADIUS_M
        }),
      )
      if (home) home.push(i)
      else clusters.push([i])
    }
    for (const c of clusters) {
      if (c.length < 2) continue
      const members = c.sort(
        (a, b) =>
          natural((stops[a] as StopIndexEntry).name, (stops[b] as StopIndexEntry).name) ||
          natural((stops[a] as StopIndexEntry).key, (stops[b] as StopIndexEntry).key),
      )
      const platforms = new Map<string, number[]>()
      for (const i of members) {
        const code = platformOf((stops[i] as StopIndexEntry).name)
        if (code) platforms.set(code, [...(platforms.get(code) ?? []), i])
      }
      const place: Place = {
        name: placeName((stops[members[0] as number] as StopIndexEntry).name),
        members,
        platforms,
      }
      for (const i of members) out.set(i, place)
    }
  }
  return out
}

const uf = new uFuzzy({ intraMode: 1, intraIns: 1 })

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(ferry terminal|railway station|station|bus station|busway station)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compactOf = (s: string) => s.replace(/[^a-z0-9]/g, '')

export function buildIndex(mode: Mode, stops: StopIndexEntry[]): ModeIndex {
  const byCode = new Map<string, number>()
  stops.forEach((s, i) => {
    if (s.code) byCode.set(s.code.replace(/^0+/, ''), i)
  })
  const haystack = stops.map((s) => clean(s.name))
  const placeOf = mode === 'bus' ? buildPlaces(stops) : new Map<number, Place>()
  return { mode, stops, haystack, compact: haystack.map(compactOf), byCode, placeOf }
}

let cached: { generation: string; indexes: Promise<ModeIndex[]> } | null = null

export function loadIndexes(store: StaticStore, generationKey: string): Promise<ModeIndex[]> {
  if (cached?.generation === generationKey) return cached.indexes
  const indexes = Promise.all(
    ASK_MODES.map(async (mode) => {
      const raw = (await readJson(store.source, `data/${mode}/stops.json`)) as StopIndexFile | null
      return buildIndex(mode, raw?.stops ?? [])
    }),
  )
  indexes.catch(() => {
    cached = null
  })
  cached = { generation: generationKey, indexes }
  return indexes
}

const single = (mode: Mode, s: StopIndexEntry, score: number): StopCandidate => ({
  mode,
  key: s.key,
  name: s.name,
  score,
  ...(s.code ? { code: s.code } : {}),
})

/**
 * Search one or all modes; best-first candidates with a 0..1 score. With `places`, stops that are one place come back
 * as one candidate (its name, every stop key), scored by its best stop or by the place name itself. With `platform`
 * (the question named one, e.g. "cultural centre platform 2"), bus candidates are only the stops carrying it: never a
 * whole station, and none when no match has it. Train and ferry ignore it (a train answer covers the station's
 * platforms and names each row's platform).
 */
export function searchStops(
  indexes: ModeIndex[],
  text: string,
  mode?: Mode,
  limit = 5,
  opts: { places?: boolean; platform?: string } = {},
): StopCandidate[] {
  const q = clean(text)
  if (!q) return []
  const places = opts.places ?? false
  const platform = opts.platform?.toLowerCase() ?? ''
  const out: StopCandidate[] = []
  for (const idx of indexes) {
    if (mode && idx.mode !== mode) continue
    const strict = !!platform && idx.mode === 'bus'
    const digits = q.replace(/^(stop\s*)?0*/, '')
    if (/^\d{1,6}$/.test(digits)) {
      // A stop number names one stop, never its whole station.
      const i = idx.byCode.get(digits)
      const s = i == null ? undefined : idx.stops[i]
      if (s) out.push(single(idx.mode, s, 1))
      continue
    }
    // One candidate per place: the first (best) hit of a place stands for it, later hits only raise its score.
    const taken = new Map<Place, StopCandidate>()
    const push = (hi: number, score: number) => {
      const s = idx.stops[hi]
      if (!s) return
      const place = places ? idx.placeOf.get(hi) : undefined
      if (!place) {
        // A named platform must be this stop's own suffix ("…, platform 2"), or it isn't the stop asked for.
        if (strict && platformOf(s.name) !== platform) return
        out.push(single(idx.mode, s, score))
        return
      }
      // A named platform picks those stops of the place, never the whole station; a place without it is dropped.
      const named = strict ? place.platforms.get(platform) : undefined
      if (strict && !named) return
      const placeScore = clean(place.name) === q ? 1 : score
      const had = taken.get(place)
      if (had) {
        had.score = Math.max(had.score, placeScore)
        return
      }
      const members = named ?? place.members
      let c: StopCandidate
      if (members.length === 1)
        c = single(idx.mode, idx.stops[members[0] as number] as StopIndexEntry, placeScore)
      else {
        const keys = members.map((m) => (idx.stops[m] as StopIndexEntry).key)
        c = {
          mode: idx.mode,
          key: keys[0] as string,
          name: named ? (idx.stops[members[0] as number] as StopIndexEntry).name : place.name,
          score: placeScore,
          stopKeys: keys,
        }
      }
      taken.set(place, c)
      out.push(c)
    }
    // Bus has 12k stops with long names; demote non-exact bus hits so a bare "toowong" prefers the station
    // unless the question says "bus".
    const busPenalty = idx.mode === 'bus' && !mode ? 0.1 : 0
    const [ids, info, order] = uf.search(idx.haystack, q, 0, 1000)
    if (!ids || ids.length === 0) {
      // uFuzzy can't bridge a missing space ("southbank"): compare with spaces and punctuation removed, exact
      // or starts-with only, so the fallback adds no looser matches than the ranking below would score.
      const cq = compactOf(q)
      if (cq.length < 4) continue
      const hits: Array<{ hi: number; score: number }> = []
      idx.compact.forEach((name, hi) => {
        if (name === cq) hits.push({ hi, score: 1 })
        else if (name.startsWith(cq)) hits.push({ hi, score: 0.9 - busPenalty })
      })
      hits.sort((a, b) => b.score - a.score)
      const start = out.length
      for (const { hi, score } of hits) {
        if (out.length - start >= limit) break
        push(hi, score)
      }
      continue
    }
    const ranked = order && info ? order.map((o) => info.idx[o] as number) : ids
    const start = out.length
    for (const [rank, hi] of ranked.entries()) {
      if (out.length - start >= limit) break
      const name = idx.haystack[hi] as string
      const score =
        name === q
          ? 1
          : name.startsWith(q)
            ? 0.9 - busPenalty
            : Math.max(0.6, 0.85 - rank * 0.05 - busPenalty)
      push(hi, score)
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

export const resolverFor =
  (indexes: ModeIndex[]): StopResolver =>
  (text, mode, opts) =>
    searchStops(indexes, text, mode, 5, {
      places: true,
      ...(opts?.platform ? { platform: opts.platform } : {}),
    })
