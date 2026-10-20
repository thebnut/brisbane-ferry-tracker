/**
 * "Remembered per device": whether this device's last stop search used the map (P3). Its own tiny module because the
 * Map button reads it on the search's first load, while the picker's logic (stop-picker.ts) stays lazy.
 */

export const MAP_PREF_KEY = 'bft-stop-picker-map'

/** Read after hydration only (never on first paint); false when storage is blocked. */
export function readMapPref(): boolean {
  try {
    return localStorage.getItem(MAP_PREF_KEY) === '1'
  } catch {
    return false
  }
}

export function writeMapPref(usedMap: boolean): void {
  try {
    if (usedMap) localStorage.setItem(MAP_PREF_KEY, '1')
    else localStorage.removeItem(MAP_PREF_KEY)
  } catch {
    // Storage blocked: the list stays the default, as on a first visit.
  }
}
