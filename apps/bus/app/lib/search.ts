/**
 * Client-side stop search (ADR-0004): uFuzzy over the 12k stop names, tuned for short names and one typo per word
 * ("cultral centre", "bowen hils"), plus exact matching on stop numbers ("10802", "010802", "stop 1771").
 * Everything runs in the browser over data/bus/stops.json; nothing per keystroke goes to a server.
 */
import uFuzzy from '@leeoniya/ufuzzy'
import type { StopIndexEntry } from './data-contract.ts'
import { normaliseCode } from './stops.ts'

export interface SearchIndex {
  entries: StopIndexEntry[]
  names: string[]
  byCode: Map<string, number>
  uf: uFuzzy
}

export function buildSearchIndex(entries: StopIndexEntry[]): SearchIndex {
  const byCode = new Map<string, number>()
  entries.forEach((e, i) => {
    if (typeof e.code === 'string') byCode.set(normaliseCode(e.code), i)
    if (/^\d+$/.test(e.key)) byCode.set(normaliseCode(e.key), i)
  })
  const uf = new uFuzzy({
    // One substitution, transposition, insertion or deletion inside each word (not the first letter).
    intraMode: 1,
    intraIns: 1,
    intraSub: 1,
    intraTrn: 1,
    intraDel: 1,
    // Words must start at a word boundary ("ann" finds "Ann Street", not "Tannery").
    interLft: 1,
  })
  return { entries, names: entries.map((e) => e.name), byCode, uf }
}

const NUMBER = /^\s*(?:stop\s*(?:no\.?|number|#)?\s*)?#?(\d{1,6})\s*$/i

export interface SearchResult {
  hits: StopIndexEntry[]
  /** Total fuzzy matches before the limit. */
  total: number
  /** An exact stop-number hit is first. */
  exact: boolean
}

/** Fallback order when uFuzzy skips ranking (over 1,000 matches for a very short query). */
function cheapRank(index: SearchIndex, idxs: number[], q: string): number[] {
  const lq = q.trim().toLowerCase()
  const score = (i: number) => {
    const n = (index.names[i] as string).toLowerCase()
    return (n.startsWith(lq) ? 0 : n.includes(` ${lq}`) ? 1 : 2) * 1000 + Math.min(n.length, 999)
  }
  return [...idxs].sort((a, b) => score(a) - score(b) || a - b)
}

export function searchStops(index: SearchIndex, query: string, limit = 20): SearchResult {
  const q = query.trim()
  if (!q) return { hits: [], total: 0, exact: false }
  const out: StopIndexEntry[] = []
  const seen = new Set<number>()
  let exact = false
  const num = NUMBER.exec(q)
  if (num) {
    const i = index.byCode.get(normaliseCode(num[1] as string))
    if (i != null) {
      out.push(index.entries[i] as StopIndexEntry)
      seen.add(i)
      exact = true
    }
  }
  // Pure numbers are stop numbers; don't fuzz them into unrelated names. "37" still matches "Stop 37" by name.
  let order: number[] = []
  const [idxs, info, ranked] = index.uf.search(index.names, q, 0, 1e3)
  if (idxs && info && ranked) order = ranked.map((o) => info.idx[o] as number)
  else if (idxs) order = cheapRank(index, idxs, q)
  if (order.length === 0 && q.includes(' ')) {
    // Words in another order ("centre cultural"): permute up to three terms.
    const [i2, info2, r2] = index.uf.search(index.names, q, 3, 1e3)
    if (i2 && info2 && r2) order = r2.map((o) => info2.idx[o] as number)
    else if (i2) order = cheapRank(index, i2, q)
  }
  for (const i of order) {
    if (out.length >= limit) break
    if (seen.has(i)) continue
    seen.add(i)
    out.push(index.entries[i] as StopIndexEntry)
  }
  return { hits: out, total: order.length + (exact ? 1 : 0), exact }
}
