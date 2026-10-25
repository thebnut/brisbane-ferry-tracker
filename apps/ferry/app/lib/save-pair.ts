/**
 * Saves the chosen stop pair (storage.ts's keys and cookie). Only the stop selector and onboarding save a pair, and
 * they are loaded when opened, so this stays off the boards' first load. A remembered pair is also a ferry favourite
 * (favourites.ts), so it shows in My Transit.
 */
import {
  addFerryFavourite,
  isFerryFavourite,
  readFerryFavourites,
  removeFerryFavourite,
  writePairCookie,
} from './favourites.ts'
import { STORAGE_KEYS } from './storage.ts'
import type { StopPair } from './terminals.ts'

export function savePair(pair: StopPair, remember: boolean): void {
  // Before the new pair replaces it: a pair remembered before favourites existed becomes one first (migration).
  readFerryFavourites()
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
  } catch {
    // Storage blocked: the pair lasts for this page view only.
  }
  if (remember) {
    const f = { from: pair.outbound.id, to: pair.inbound.id }
    const had = isFerryFavourite(f)
    // A new favourite that storage kept is a save (the stop selector, onboarding, My Transit's Settings re-run).
    if (!had && isFerryFavourite(f, addFerryFavourite(f))) window.__bftGa?.saveStop('ferry', f.from)
  }
  writePairCookie()
}

/**
 * Unsaves the pair (remembered and this session's), the favourite it made and its cookie: the boards go back to the
 * first other favourite, or the default pair.
 */
export function clearPair(): void {
  let remembered: StopPair | null = null
  try {
    if (localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION) === 'true')
      remembered = JSON.parse(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS) ?? 'null') as StopPair | null
  } catch {
    // Blocked or malformed: no remembered favourite to take out.
  }
  try {
    localStorage.removeItem(STORAGE_KEYS.REMEMBER_SELECTION)
    localStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS)
    sessionStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS_SESSION)
  } catch {
    // Storage blocked: there was nothing saved to clear.
  }
  if (remembered?.outbound?.id && remembered.inbound?.id)
    removeFerryFavourite({ from: remembered.outbound.id, to: remembered.inbound.id })
  writePairCookie()
}
