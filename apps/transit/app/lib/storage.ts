/** Cookies and small localStorage helpers for the transit pages (the mode pages keep their apps' own storage). */

/** Same cookie names as the standalone apps, so a theme or fixture switch carries across every tab. */
export const THEME_COOKIE = 'bft_theme'
export const FIXTURE_COOKIE = 'bft_fixtures'
/** Last position the Nearby tab used (rounded to ~100 m), so a revisit shows results before GPS answers. */
export const NEARBY_KEY = 'bft-transit-nearby'

export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='))
      } catch {
        return null
      }
    }
  }
  return null
}

export function safe<T>(f: () => T, fallback: T): T {
  try {
    return f()
  } catch {
    return fallback
  }
}

export interface Place {
  lat: number
  lon: number
  /** "gps", or the stop the user picked instead ("Use a stop"). */
  source: 'gps' | 'stop'
  label?: string
}

export function readPlace(): Place | null {
  const v = safe(() => JSON.parse(localStorage.getItem(NEARBY_KEY) ?? 'null') as Place | null, null)
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null
}

export function writePlace(p: Place): void {
  const r = (x: number) => Math.round(x * 1000) / 1000
  safe(() => localStorage.setItem(NEARBY_KEY, JSON.stringify({ ...p, lat: r(p.lat), lon: r(p.lon) })), undefined)
}
