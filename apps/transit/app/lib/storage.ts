/** Cookies and small localStorage helpers for the transit pages (the mode pages keep their apps' own storage). */

/** Same cookie names as the standalone apps, so a theme or fixture switch carries across every tab. */
export const THEME_COOKIE = 'bft_theme'
export const FIXTURE_COOKIE = 'bft_fixtures'
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
