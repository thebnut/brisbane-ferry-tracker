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
/** A trip stop's display name: the curated terminal name wins over the API's GTFS name, then the bare stop id. */
export const tripStopName = (stopId: string, apiName?: string | null): string =>
  terminalById(stopId)?.name ?? apiName ?? stopId
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

/** A terminal named in a URL: its slug (`?to=riverside`), or its stop id (the old `?from=317584&to=317590` links). */
export const terminalByParam = (value: string | null | undefined): Terminal | null =>
  value ? (terminalBySlug(value) ?? terminalById(value)) : null

/** The "To" a board URL asks for: a terminal the origin reaches directly, else none. */
export function destinationParam(origin: Terminal, value: string | null | undefined): Terminal | null {
  const to = terminalByParam(value)
  return to && to.id !== origin.id && origin.destinations.includes(to.id) ? to : null
}

/** A terminal's board (THE-118 PR 5), with its "To" (`?to=<slug>`) when one is set. */
export const boardHref = (fromId: string, toId?: string | null): string => {
  const from = terminalById(fromId)
  const to = toId ? terminalById(toId) : null
  return from ? `${terminalHref(from.slug)}${to ? `?to=${to.slug}` : ''}` : at('/')
}

/** A ferry's trip page (THE-118 PR 6), from the terminal you board at to your "To" when the board has one. */
export const tripHref = (tripInstance: string, fromId: string, toId?: string | null): string => {
  const q = new URLSearchParams()
  const from = terminalById(fromId)
  const to = toId ? terminalById(toId) : null
  if (from) q.set('from', from.slug)
  if (to) q.set('to', to.slug)
  return `${at('/trip')}/${encodeURIComponent(tripInstance)}${q.size ? `?${q}` : ''}`
}

/**
 * Where an old `/?from=<stopId>&to=<stopId>` link (R3-F2) now goes: that terminal's board, with "To" when the origin
 * reaches it, keeping the link's other parameters. Null when it names no known origin (it stays a home link).
 */
export function boardForOldLink(params: URLSearchParams): string | null {
  const origin = terminalByParam(params.get('from'))
  if (!origin) return null
  const to = destinationParam(origin, params.get('to'))
  const q = new URLSearchParams(to ? { to: to.slug } : {})
  for (const [k, v] of params) if (k !== 'from' && k !== 'to') q.append(k, v)
  return `${terminalHref(origin.slug)}${q.size ? `?${q}` : ''}`
}

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
