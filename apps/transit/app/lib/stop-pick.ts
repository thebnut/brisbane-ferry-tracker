/**
 * "Use a stop" (the Nearby fallback when location is off): pick any ferry terminal, train station or bus stop by name
 * or number, and Around you centres on it. Searches the three modes' stop indexes (data/{mode}/stops.json; bus is
 * the big one, fetched only once the picker opens).
 */

import type { NearbyMode } from './nearby.ts'

export interface PickStop {
  mode: NearbyMode
  key: string
  name: string
  code?: string
  lat: number
  lon: number
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Best matches first: exact stop number, then name prefix, then a word prefix, then anywhere; ferry/train first. */
export function matchStops(query: string, stops: PickStop[], limit = 8): PickStop[] {
  const q = norm(query)
  if (q.length < 2) return []
  const digits = /^\d+$/.test(q) ? q.replace(/^0+/, '') : null
  const scored: Array<[number, PickStop]> = []
  for (const s of stops) {
    const n = norm(s.name)
    let score = -1
    if (digits && (s.code?.replace(/^0+/, '') === digits || s.key === digits)) score = 0
    else if (n.startsWith(q)) score = 1
    else if (n.includes(` ${q}`)) score = 2
    else if (n.includes(q)) score = 3
    if (score >= 0) scored.push([score * 10 + (s.mode === 'bus' ? 1 : 0), s])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
  return scored.slice(0, limit).map(([, s]) => s)
}
