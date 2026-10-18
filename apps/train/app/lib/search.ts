/**
 * Station search (ADR-0004): uFuzzy 1.0.19 over the station names, tuned for short names and one typo per word
 * ("bowen hils", "indooroopily"), ranked by uFuzzy's sort. Prefix matches of any word come first so "cen" finds
 * Central before Springfield Central.
 */
import uFuzzy from '@leeoniya/ufuzzy'

export interface Searchable {
  key: string
  name: string
}

const uf = new uFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1 })

export function searchStations<T extends Searchable>(query: string, items: T[], max = 12): T[] {
  const q = query.trim()
  if (!q) return items.slice(0, max)
  const hay = items.map((s) => s.name)
  const [idxs, info, order] = uf.search(hay, q, 0, 1e3)
  let ranked: number[] = []
  if (info && order) ranked = order.map((i) => info.idx[i] as number)
  else if (idxs) ranked = idxs
  const lower = q.toLowerCase()
  const starts = (i: number) => (hay[i] as string).toLowerCase().startsWith(lower)
  ranked.sort((a, b) => Number(starts(b)) - Number(starts(a)))
  return ranked.slice(0, max).map((i) => items[i] as T)
}
