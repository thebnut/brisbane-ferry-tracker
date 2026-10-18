/**
 * Stop selection persistence. Uses the legacy app's localStorage/sessionStorage keys and shapes so visitors keep
 * their saved pair when brisbaneferry.com moves to this app, plus a small cookie so the server can render the
 * saved pair's rows into the HTML.
 */
import { normalisePair, type StopPair } from './terminals.ts'

export const STORAGE_KEYS = {
  SELECTED_STOPS: 'brisbane-ferry-selected-stops',
  SELECTED_STOPS_SESSION: 'brisbane-ferry-selected-stops-session',
  REMEMBER_SELECTION: 'brisbane-ferry-remember-selection',
  DEPARTURE_TIME: 'brisbane-ferry-departure-time',
} as const

export const PAIR_COOKIE = 'bft_pair'
export const FIXTURE_COOKIE = 'bft_fixtures'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function parsePair(raw: string | null): StopPair | null {
  if (!raw) return null
  const p = safe(() => JSON.parse(raw) as StopPair, null)
  return p?.outbound?.id && p?.inbound?.id ? normalisePair(p) : null
}

/** Saved pair: localStorage (remembered) first, then this session's (legacy App.jsx order). */
export function readSavedPair(): StopPair | null {
  return (
    parsePair(safe(() => localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS), null)) ??
    parsePair(safe(() => sessionStorage.getItem(STORAGE_KEYS.SELECTED_STOPS_SESSION), null))
  )
}

/** First visit, or "Remember selection" off: show the stop selector (legacy rule). */
export function shouldShowSelector(): boolean {
  const remember = safe(() => localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION), null) === 'true'
  const saved = safe(() => localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS), null)
  return !saved || !remember
}

export function readRemember(): boolean {
  return safe(() => localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION), null) === 'true'
}

export function savePair(pair: StopPair, remember: boolean): void {
  safe(() => {
    if (remember) {
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, JSON.stringify(pair))
      sessionStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS_SESSION)
    } else {
      localStorage.removeItem(STORAGE_KEYS.REMEMBER_SELECTION)
      localStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS)
      sessionStorage.setItem(STORAGE_KEYS.SELECTED_STOPS_SESSION, JSON.stringify(pair))
    }
    const maxAge = remember ? '; max-age=31536000' : ''
    document.cookie = `${PAIR_COOKIE}=${pair.outbound.id}.${pair.inbound.id}; path=/; samesite=lax${maxAge}`
  }, undefined)
}

export function readDepartAt(): number | null {
  const v = safe(() => sessionStorage.getItem(STORAGE_KEYS.DEPARTURE_TIME), null)
  const ms = v ? Date.parse(v) : Number.NaN
  return Number.isFinite(ms) && ms > Date.now() ? Math.floor(ms / 1000) : null
}

export function writeDepartAt(epochS: number | null): void {
  safe(() => {
    if (epochS) sessionStorage.setItem(STORAGE_KEYS.DEPARTURE_TIME, new Date(epochS * 1000).toISOString())
    else sessionStorage.removeItem(STORAGE_KEYS.DEPARTURE_TIME)
  }, undefined)
}

export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

/** Pair from the request cookie, for SSR. */
export function pairFromCookie(cookieHeader: string | null): StopPair | null {
  const v = getCookie(cookieHeader, PAIR_COOKIE)
  const m = v ? /^(\d+)\.(\d+)$/.exec(v) : null
  if (!m) return null
  return normalisePair({ outbound: { id: m[1] as string, name: '' }, inbound: { id: m[2] as string, name: '' } })
}

/** Offline copy of the last good response per pair (shown as scheduled times when offline). */
const offlineKey = (from: string, to: string) => `bft-ferry-v1:${from}:${to}`
export function writeOffline(from: string, to: string, body: unknown): void {
  safe(() => localStorage.setItem(offlineKey(from, to), JSON.stringify(body)), undefined)
}
export function readOffline(from: string, to: string): unknown {
  return safe(() => JSON.parse(localStorage.getItem(offlineKey(from, to)) ?? 'null'), null)
}
