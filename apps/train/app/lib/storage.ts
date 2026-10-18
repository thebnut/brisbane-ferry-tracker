/**
 * Browser persistence: favourite trips (localStorage, mirrored into a small cookie so the server can render their
 * rows into the home page HTML), the offline full-day timetable per favourite, and the theme preference.
 */
import type { Departure } from '@bft/core/contract'

export const FAVOURITES_KEY = 'bft-train-favourites'
export const FAV_COOKIE = 'bft_fav'
export const THEME_COOKIE = 'bft_theme'
export const FIXTURE_COOKIE = 'bft_fixtures'
const OFFLINE_PREFIX = 'bft-train-offline:'
/** Favourites rendered on the server (the cookie stays small). */
export const MAX_SSR_FAVOURITES = 3
export const MAX_FAVOURITES = 8

export interface Favourite {
  from: string
  to: string | null
}

export type Theme = 'system' | 'light' | 'dark'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const KEY_RE = /^[a-z0-9-]+$/

export const favouriteId = (f: Favourite) => `${f.from}.${f.to ?? ''}`
export const sameFavourite = (a: Favourite, b: Favourite) =>
  a.from === b.from && (a.to ?? null) === (b.to ?? null)

function clean(list: unknown): Favourite[] {
  if (!Array.isArray(list)) return []
  const out: Favourite[] = []
  for (const f of list) {
    const from = (f as Favourite)?.from
    const to = (f as Favourite)?.to ?? null
    if (typeof from !== 'string' || !KEY_RE.test(from)) continue
    if (to != null && (typeof to !== 'string' || !KEY_RE.test(to))) continue
    if (!out.some((x) => sameFavourite(x, { from, to }))) out.push({ from, to })
  }
  return out.slice(0, MAX_FAVOURITES)
}

export function readFavourites(): Favourite[] {
  return clean(safe(() => JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]'), []))
}

/** "central.indooroopilly,roma-street." — the first few favourites, for SSR. */
export const favouritesCookieValue = (list: Favourite[]) =>
  list.slice(0, MAX_SSR_FAVOURITES).map(favouriteId).join(',')

export function writeFavourites(list: Favourite[]): Favourite[] {
  const next = clean(list)
  safe(() => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next))
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in Safari; this is a plain preference cookie.
    document.cookie = `${FAV_COOKIE}=${encodeURIComponent(favouritesCookieValue(next))}; path=/; samesite=lax; max-age=31536000`
  }, undefined)
  return next
}

export function toggleFavourite(list: Favourite[], f: Favourite): Favourite[] {
  const has = list.some((x) => sameFavourite(x, f))
  return writeFavourites(has ? list.filter((x) => !sameFavourite(x, f)) : [f, ...list])
}

export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return safe(() => decodeURIComponent(v.join('=')), null)
  }
  return null
}

export function favouritesFromCookie(header: string | null): Favourite[] {
  const v = getCookie(header, FAV_COOKIE)
  if (!v) return []
  return clean(
    v.split(',').map((part) => {
      const [from, to] = part.split('.')
      return { from, to: to || null }
    }),
  ).slice(0, MAX_SSR_FAVOURITES)
}

export function themeFromCookie(header: string | null): Theme {
  const v = getCookie(header, THEME_COOKIE)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function writeTheme(theme: Theme): void {
  safe(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: plain preference cookie, read by the server to avoid a flash.
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; samesite=lax; max-age=31536000`
  }, undefined)
}

/** The rest of today's timetable for one favourite, kept for offline use ("Offline · scheduled"). */
export interface OfflineDay {
  savedAt: number
  serviceDate: string
  from: string
  to: string | null
  departures: Departure[]
}

const offlineKey = (from: string, to: string | null) => `${OFFLINE_PREFIX}${from}:${to ?? ''}`

export function writeOfflineDay(day: OfflineDay): void {
  safe(() => localStorage.setItem(offlineKey(day.from, day.to), JSON.stringify(day)), undefined)
}

export function readOfflineDay(from: string, to: string | null): OfflineDay | null {
  const d = safe(
    () => JSON.parse(localStorage.getItem(offlineKey(from, to)) ?? 'null') as OfflineDay | null,
    null,
  )
  return d && Array.isArray(d.departures) ? d : null
}

/** Drop offline copies that no longer belong to a favourite. */
export function pruneOffline(keep: Favourite[]): void {
  safe(() => {
    const wanted = new Set(keep.map((f) => offlineKey(f.from, f.to)))
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(OFFLINE_PREFIX) && !wanted.has(k)) localStorage.removeItem(k)
    }
  }, undefined)
}
