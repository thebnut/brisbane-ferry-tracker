/**
 * Fuzzy stop resolver for /v1/ask and the search_stops tool: uFuzzy over each mode's stop index
 * (data/{mode}/stops.json, ADR-0004), exact matching on bus stop numbers.
 */

import type { Mode, StopCandidate, StopIndexEntry, StopIndexFile, StopResolver } from '@bft/core'
import uFuzzy from '@leeoniya/ufuzzy'
import { readJson } from '../data/source.ts'
import type { StaticStore } from '../data/static-store.ts'

export const ASK_MODES: Mode[] = ['ferry', 'train', 'bus']

interface ModeIndex {
  mode: Mode
  stops: StopIndexEntry[]
  haystack: string[]
  byCode: Map<string, number>
}

const uf = new uFuzzy({ intraMode: 1, intraIns: 1 })

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(ferry terminal|railway station|station|bus station|busway station)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

let cached: { generation: string; indexes: Promise<ModeIndex[]> } | null = null

export function loadIndexes(store: StaticStore, generationKey: string): Promise<ModeIndex[]> {
  if (cached?.generation === generationKey) return cached.indexes
  const indexes = Promise.all(
    ASK_MODES.map(async (mode) => {
      const raw = (await readJson(store.source, `data/${mode}/stops.json`)) as StopIndexFile | null
      const stops = raw?.stops ?? []
      const byCode = new Map<string, number>()
      stops.forEach((s, i) => {
        if (s.code) byCode.set(s.code.replace(/^0+/, ''), i)
      })
      return { mode, stops, haystack: stops.map((s) => clean(s.name)), byCode }
    }),
  )
  indexes.catch(() => {
    cached = null
  })
  cached = { generation: generationKey, indexes }
  return indexes
}

/** Search one or all modes; best-first candidates with a 0..1 score. */
export function searchStops(indexes: ModeIndex[], text: string, mode?: Mode, limit = 5): StopCandidate[] {
  const q = clean(text)
  if (!q) return []
  const out: StopCandidate[] = []
  for (const idx of indexes) {
    if (mode && idx.mode !== mode) continue
    const digits = q.replace(/^(stop\s*)?0*/, '')
    if (/^\d{1,6}$/.test(digits)) {
      const i = idx.byCode.get(digits)
      const s = i == null ? undefined : idx.stops[i]
      if (s) out.push({ mode: idx.mode, key: s.key, name: s.name, score: 1 })
      continue
    }
    const [ids, info, order] = uf.search(idx.haystack, q, 0, 1000)
    if (!ids || ids.length === 0) continue
    const ranked = order && info ? order.map((o) => info.idx[o] as number) : ids
    ranked.slice(0, limit).forEach((hi, rank) => {
      const s = idx.stops[hi]
      if (!s) return
      const name = idx.haystack[hi] as string
      // Bus has 12k stops with long names; demote non-exact bus hits so a bare "toowong" prefers the station
      // unless the question says "bus".
      const busPenalty = idx.mode === 'bus' && !mode ? 0.1 : 0
      const score =
        name === q
          ? 1
          : name.startsWith(q)
            ? 0.9 - busPenalty
            : Math.max(0.6, 0.85 - rank * 0.05 - busPenalty)
      out.push({ mode: idx.mode, key: s.key, name: s.name, score })
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

export const resolverFor =
  (indexes: ModeIndex[]): StopResolver =>
  (text, mode) =>
    searchStops(indexes, text, mode)
