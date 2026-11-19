/**
 * The ferry home's journey planner ("Where are you going?"): From first, then To. Everything here is worked out from
 * the bundled terminal list (terminals.json: each terminal's direct destinations and position), so a position never
 * leaves the phone and nothing is fetched to plan. A pair with no direct ferry gets one change at most ("Change at
 * Sydney Street"), the cross-river ferries' case (F22 Dockside, F23 Holman Street, F24 Maritime Museum).
 */
import { TERMINALS, type Terminal, terminalById, terminalBySlug } from './terminals.ts'

/**
 * Terminals closed for works: left out of Popular, of the planner's nearest-terminal default and of change points, and
 * labelled in the lists. Bulimba: gangway works from 9 Nov 2026, reopening "mid-December" (Brisbane City Council,
 * TransLink) with no confirmed date; TransLink's timetable has no Bulimba services meanwhile, and its board says so
 * (a 404 "unknown stop"). Removed by hand once the reopening is confirmed (and 317584 is back in the timetable), never
 * by a guessed date.
 */
export const CLOSED: Record<string, { note: string }> = {
  '317584': { note: 'Closed for works' },
}

/** The terminal's closure note while it is closed, else null. `nowMs` is kept for a dated closure later. */
export function closedNote(id: string, _nowMs: number): string | null {
  return CLOSED[id]?.note ?? null
}

/** Popular destinations (the To chips), in order; a closed one is left out. */
export const POPULAR = [
  'south-bank',
  'howard-smith-wharves',
  'northshore-hamilton',
  'new-farm-park',
  'uq-st-lucia',
  'bulimba',
] as const

export const popularTerminals = (nowMs: number): Terminal[] =>
  POPULAR.map((s) => terminalBySlug(s)).filter((t): t is Terminal => !!t && !closedNote(t.id, nowMs))

export const isDirect = (fromId: string, toId: string): boolean =>
  fromId !== toId && !!terminalById(fromId)?.destinations.includes(toId)

/** Distance in metres (haversine). */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export type Plan =
  | { kind: 'same' }
  | { kind: 'direct' }
  /** One change: ride to `via`, then on to the destination. */
  | { kind: 'change'; via: Terminal }
  /** More than one change (e.g. Dockside to Holman Street): no suggestion. */
  | { kind: 'none' }

/**
 * How to get from one terminal to another: direct, or with one change at the terminal both legs reach directly. With
 * several, the shortest by distance (from → via → to); a closed terminal is never the change.
 */
export function planTrip(fromId: string, toId: string, nowMs: number): Plan {
  if (fromId === toId) return { kind: 'same' }
  const from = terminalById(fromId)
  const to = terminalById(toId)
  if (!from || !to) return { kind: 'none' }
  if (isDirect(fromId, toId)) return { kind: 'direct' }
  let best: { via: Terminal; m: number } | null = null
  for (const id of from.destinations) {
    const via = terminalById(id)
    if (!via || id === toId || closedNote(id, nowMs) || !via.destinations.includes(toId)) continue
    const m = metres(from, via) + metres(via, to)
    if (!best || m < best.m) best = { via, m }
  }
  return best ? { kind: 'change', via: best.via } : { kind: 'none' }
}

/** A terminal's distance from a position, in metres. */
export const metresFrom = (lat: number, lon: number, t: Terminal) => metres({ lat, lng: lon }, t)

/** The open terminals nearest a position, closest first. */
export function closestTerminals(lat: number, lon: number, nowMs: number, limit = 3) {
  return TERMINALS.filter((t) => !closedNote(t.id, nowMs))
    .map((t) => ({ terminal: t, metres: metresFrom(lat, lon, t) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit)
}

/**
 * Where a trip starts by default once the position is known: of the three nearest open terminals, the closest with a
 * direct ferry to `toId` (when one is set), else the nearest.
 */
export function nearestStart(lat: number, lon: number, toId: string | null, nowMs: number): Terminal | null {
  const near = closestTerminals(lat, lon, nowMs).filter((c) => c.terminal.id !== toId)
  const direct = toId ? near.find((c) => isDirect(c.terminal.id, toId)) : undefined
  return (direct ?? near[0])?.terminal ?? null
}

/** The planner's last destination on this device (a terminal slug), as Saved keeps its list: localStorage only. */
export const LAST_TO_KEY = 'bft-ferry-last-to'

export function readLastTo(): Terminal | null {
  try {
    return terminalBySlug(localStorage.getItem(LAST_TO_KEY) ?? '')
  } catch {
    return null
  }
}

export function writeLastTo(slug: string | null): void {
  try {
    if (slug) localStorage.setItem(LAST_TO_KEY, slug)
    else localStorage.removeItem(LAST_TO_KEY)
  } catch {
    // Storage off (private mode): the planner just starts blank next time.
  }
}
