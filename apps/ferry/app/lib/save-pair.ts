/**
 * Saves the chosen stop pair (storage.ts's keys and cookie). Only the stop selector saves a pair, and it is loaded
 * when opened, so this stays off the boards' first load.
 */
import { PAIR_COOKIE, STORAGE_KEYS } from './storage.ts'
import type { StopPair } from './terminals.ts'

export function savePair(pair: StopPair, remember: boolean): void {
  try {
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
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in Safari; this is a plain preference cookie.
    document.cookie = `${PAIR_COOKIE}=${pair.outbound.id}.${pair.inbound.id}; path=/; samesite=lax${maxAge}`
  } catch {
    // Storage or cookies blocked: the pair lasts for this page view only.
  }
}
