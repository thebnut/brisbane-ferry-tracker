/**
 * Ferry terminals and direct connectivity, generated from GTFS by scripts/build-fixtures.ts (app/data/terminals.json).
 * Slugs and ids match the legacy app's src/utils/terminals.js, so /terminal/<slug> URLs are unchanged.
 */
import data from '../data/terminals.json'
import { at } from './base.ts'

export interface Terminal {
  id: string
  name: string
  slug: string
  lat: number
  lng: number
  /** Terminals reachable directly from this one. */
  destinations: string[]
  /** Route codes boarding here (F1, F11, …). */
  routes: string[]
}

export interface StopChoice {
  id: string
  name: string
}

export interface StopPair {
  outbound: StopChoice
  inbound: StopChoice
}

export const TERMINALS: Terminal[] = data

const byId = new Map(TERMINALS.map((t) => [t.id, t]))
const bySlug = new Map(TERMINALS.map((t) => [t.slug, t]))

export const BULIMBA = '317584'
export const RIVERSIDE = '317590'

export const DEFAULT_STOPS: StopPair = {
  outbound: { id: BULIMBA, name: 'Bulimba' },
  inbound: { id: RIVERSIDE, name: 'Riverside' },
}

export const terminalById = (id: string): Terminal | null => byId.get(id) ?? null
export const terminalBySlug = (slug: string): Terminal | null => bySlug.get(slug) ?? null
/** Canonical (unprefixed) terminal path for seo.ts and the sitemap; links use terminalHref. */
export const terminalPath = (slug: string) => `/terminal/${slug}`
/** In-app link to a terminal page (prefixed with BASE inside BrisbaneTransit). */
export const terminalHref = (slug: string) => at(terminalPath(slug))

export const validDestinations = (originId: string): string[] => byId.get(originId)?.destinations ?? []

export const choice = (t: Terminal): StopChoice => ({ id: t.id, name: t.name })

/** Keep the pair valid: an unknown origin falls back to the default; an unreachable destination to the first one. */
export function normalisePair(pair: StopPair | null | undefined): StopPair {
  const origin = pair && terminalById(pair.outbound.id)
  if (!origin) return DEFAULT_STOPS
  const dests = origin.destinations
  const dest =
    pair && dests.includes(pair.inbound.id) ? terminalById(pair.inbound.id) : terminalById(dests[0] ?? '')
  if (!dest) return DEFAULT_STOPS
  return { outbound: choice(origin), inbound: choice(dest) }
}

/**
 * The pair a /terminal/<slug> page opens with (legacy App.jsx stopsForTerminal): keep the visitor's usual pairing if
 * it involves this terminal, otherwise head for Riverside (or Bulimba from Riverside).
 */
export function pairForTerminal(terminal: Terminal, saved: StopPair | null): StopPair {
  const origin = choice(terminal)
  if (saved?.outbound.id === terminal.id) return normalisePair({ outbound: origin, inbound: saved.inbound })
  if (saved?.inbound.id === terminal.id) return normalisePair({ outbound: origin, inbound: saved.outbound })
  const destination = terminal.id === RIVERSIDE ? DEFAULT_STOPS.outbound : DEFAULT_STOPS.inbound
  return normalisePair({ outbound: origin, inbound: destination })
}

/**
 * The pair a deep link asks for (`?from=<stopId>&to=<stopId>`, R3-F2), checked against the known terminals and their
 * direct connections: an unknown origin is ignored (null); a missing or unreachable destination keeps the fallback
 * pair's destination when the origin reaches it, otherwise the origin's first destination.
 */
export function pairFromParams(params: URLSearchParams, fallback: StopPair): StopPair | null {
  const origin = terminalById(params.get('from') ?? '')
  if (!origin) return null
  const to = params.get('to')
  const wanted = to && origin.destinations.includes(to) ? to : fallback.inbound.id
  return normalisePair({ outbound: choice(origin), inbound: { id: wanted, name: '' } })
}

/** Change the origin, keeping the destination when still reachable (legacy handleTemporaryOriginChange). */
export function withOrigin(pair: StopPair, originId: string): StopPair {
  const t = terminalById(originId)
  if (!t) return pair
  return normalisePair({ outbound: choice(t), inbound: pair.inbound })
}

export function withDestination(pair: StopPair, destinationId: string): StopPair {
  const t = terminalById(destinationId)
  if (!t) return pair
  return { outbound: pair.outbound, inbound: choice(t) }
}

export const swapPair = (pair: StopPair): StopPair =>
  normalisePair({ outbound: pair.inbound, inbound: pair.outbound })

/** Distance in metres (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function nearbyTerminals(terminal: Terminal, count = 3) {
  return TERMINALS.filter((t) => t.id !== terminal.id)
    .map((t) => ({ ...t, meters: haversineMeters(terminal.lat, terminal.lng, t.lat, t.lng) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count)
}
