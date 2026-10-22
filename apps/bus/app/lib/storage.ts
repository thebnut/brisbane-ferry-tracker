import { isDemoSession } from '@bft/ui/demo'
/**
 * Per-device preferences: saved stops ("My stops"), recent searches, theme and offline timetable copies. Saved
 * stops and the theme also go in small cookies so the server can render the right rows and colours into the HTML.
 */
import { useSyncExternalStore } from 'react'

export const KEYS = {
  SAVED: 'bft-bus-saved',
  RECENT: 'bft-bus-recent',
  THEME: 'bft-theme',
} as const
export const SAVED_COOKIE = 'bft_bus_saved'
export const THEME_COOKIE = 'bft_theme'
export const FIXTURE_COOKIE = 'bft_fixtures'
/** Saved stops whose rows the server renders on the home page. */
export const SSR_SAVED_MAX = 3

export interface SavedStop {
  id: string
  name: string
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function readList(key: string): SavedStop[] {
  const v = safe(() => JSON.parse(localStorage.getItem(key) ?? '[]') as unknown, [])
  return Array.isArray(v)
    ? v.filter((s): s is SavedStop => typeof s?.id === 'string' && typeof s?.name === 'string')
    : []
}

// ---- saved stops (a tiny external store so every component sees changes) ----
const listeners = new Set<() => void>()
let savedCache: SavedStop[] | null = null
const EMPTY: SavedStop[] = []

export function readSaved(): SavedStop[] {
  savedCache ??= readList(KEYS.SAVED)
  return savedCache
}

/** Saves the list; when storage refuses it, every list shows what storage still holds (R27-S1). */
export function writeSaved(list: SavedStop[]) {
  const kept = safe(() => {
    localStorage.setItem(KEYS.SAVED, JSON.stringify(list))
    return true
  }, false)
  savedCache = kept ? list : null
  // The cookie follows what storage holds, so the server never renders a stop that was not saved.
  const ids = readSaved()
    .slice(0, SSR_SAVED_MAX)
    .map((s) => s.id)
    .filter((id) => /^[\w-]+$/.test(id))
  safe(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in Safari; a plain preference cookie.
    document.cookie = `${SAVED_COOKIE}=${ids.join('.')}; path=/; samesite=lax; max-age=31536000`
  }, undefined)
  for (const l of listeners) l()
}

export function isSaved(id: string): boolean {
  return readSaved().some((s) => s.id === id)
}

export function toggleSaved(stop: SavedStop): boolean {
  const list = readSaved()
  const next = list.some((s) => s.id === stop.id) ? list.filter((s) => s.id !== stop.id) : [...list, stop]
  writeSaved(next)
  return next.length > list.length
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEYS.SAVED) {
      savedCache = null
      fn()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

/** Saved stops; on the server and during hydration, the ids from the cookie (names filled in later). */
export function useSavedStops(serverSaved: SavedStop[] = EMPTY): SavedStop[] {
  return useSyncExternalStore(subscribe, readSaved, () => serverSaved)
}

// ---- recent searches ----
export function readRecent(): SavedStop[] {
  return readList(KEYS.RECENT)
}
export function pushRecent(stop: SavedStop): void {
  const next = [stop, ...readRecent().filter((s) => s.id !== stop.id)].slice(0, 5)
  safe(() => localStorage.setItem(KEYS.RECENT, JSON.stringify(next)), undefined)
}

// ---- theme ----
export type ThemePref = 'system' | 'light' | 'dark'
export function readTheme(): ThemePref {
  const v = safe(() => localStorage.getItem(KEYS.THEME), null)
  return v === 'light' || v === 'dark' ? v : 'system'
}
export function writeTheme(pref: ThemePref): void {
  safe(() => {
    if (pref === 'system') localStorage.removeItem(KEYS.THEME)
    else localStorage.setItem(KEYS.THEME, pref)
    // biome-ignore lint/suspicious/noDocumentCookie: plain preference cookie (see above).
    document.cookie = `${THEME_COOKIE}=${pref}; path=/; samesite=lax; max-age=31536000`
  }, undefined)
  applyTheme(pref)
}
export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
/** Inline <head> script: set the dark class before first paint (no flash). */
export const THEME_SCRIPT = `try{var p=localStorage.getItem('${KEYS.THEME}');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}`

// ---- offline timetable copies (saved stops, and the stops viewed most recently) ----
const OFFLINE_PREFIX = 'bft-bus-v1:'
const offlineKey = (stopId: string) => `${OFFLINE_PREFIX}${stopId}`
/** Copies kept for stops that aren't saved (~40 KB each); saved stops always keep theirs. */
export const OFFLINE_UNSAVED_MAX = 8

export function writeOffline(stopId: string, body: unknown): void {
  // A visitor's demo session keeps nothing on the device (R7-B1).
  if (isDemoSession()) return
  safe(() => {
    localStorage.setItem(offlineKey(stopId), JSON.stringify({ savedAt: Date.now(), body }))
    pruneOffline()
  }, undefined)
}

/** Drop the oldest copies of unsaved stops beyond OFFLINE_UNSAVED_MAX. */
function pruneOffline(): void {
  const saved = new Set(readSaved().map((s) => s.id))
  const unsaved: Array<{ key: string; savedAt: number }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(OFFLINE_PREFIX) || saved.has(key.slice(OFFLINE_PREFIX.length))) continue
    unsaved.push({ key, savedAt: readOffline(key.slice(OFFLINE_PREFIX.length))?.savedAt ?? 0 })
  }
  unsaved.sort((a, b) => b.savedAt - a.savedAt)
  for (const { key } of unsaved.slice(OFFLINE_UNSAVED_MAX)) localStorage.removeItem(key)
}

export function readOffline(stopId: string): { savedAt: number; body: unknown } | null {
  const v = safe(() => JSON.parse(localStorage.getItem(offlineKey(stopId)) ?? 'null') as unknown, null)
  return v && typeof v === 'object' && 'body' in v ? (v as { savedAt: number; body: unknown }) : null
}
/** A timetable copy with at least one departure is on this device (it may have run out since). */
export function hasTimetableCopy(stopId: string): boolean {
  const body = readOffline(stopId)?.body as { departures?: unknown } | undefined
  return Array.isArray(body?.departures) && body.departures.length > 0
}

export function dropOffline(stopId: string): void {
  safe(() => localStorage.removeItem(offlineKey(stopId)), undefined)
}

// ---- cookies (server side) ----
export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k !== name) continue
    try {
      return decodeURIComponent(v.join('='))
    } catch {
      // Malformed encoding: treat the cookie as absent.
      return null
    }
  }
  return null
}

export function savedFromCookie(header: string | null): string[] {
  const v = getCookie(header, SAVED_COOKIE)
  if (!v) return []
  return v
    .split('.')
    .filter((id) => /^[\w-]{1,32}$/.test(id))
    .slice(0, SSR_SAVED_MAX)
}

export function themeFromCookie(header: string | null): ThemePref {
  const v = getCookie(header, THEME_COOKIE)
  return v === 'light' || v === 'dark' ? v : 'system'
}
