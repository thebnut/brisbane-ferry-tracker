/**
 * Deleting a saved item from My Transit (THE-115), loaded with the swipe rows (SavedRows.tsx), never on first load.
 * The item stops being saved: it leaves its own mode's store through that store's own code (ferry
 * removeFerryFavourite, which also forgets the remembered pair when it is that trip; train writeFavourites, bus
 * writeSaved), so the standalone apps see the change, and leaves the overlay's
 * order and names. Undo puts back exactly what was there: the store entry at its place, the overlay place and name.
 * Each change is written straight away, so a reload or leaving the page keeps it.
 */

import { KEYS as BUS_KEYS, readSaved, type SavedStop, writeSaved } from '@bft/bus/app/lib/storage.ts'
import {
  addFerryFavourite,
  FAVOURITES_KEY as FERRY_FAVOURITES,
  type FerryFavourite,
  isFerryFavourite,
  readFerryFavourites,
  removeFerryFavourite,
  sameFerryFavourite,
  writePairCookie,
} from '@bft/ferry/app/lib/favourites.ts'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import {
  type Favourite,
  MAX_FAVOURITES,
  readFavourites,
  sameFavourite,
  writeFavourites,
} from '@bft/train/app/lib/storage.ts'
// Types only: a value import would pull these modules out of the page's chunk (saved-prefs-save.ts says why).
import type { SavedItem } from './saved.ts'
import type { PrefsStore } from './saved-prefs-save.ts'

/** What a delete took away, for Undo. */
export interface Removal {
  item: SavedItem
  /** The store's entry and its place there; null when the store no longer had it (another tab unsaved it). */
  entry:
    | {
        mode: 'ferry'
        at: number
        fav: FerryFavourite
        /** The remembered pair this delete forgot (it was this trip), for Undo; null when it left it alone. */
        forgot: { local: string; remember: string | null } | null
      }
    | { mode: 'train'; at: number; fav: Favourite }
    | { mode: 'bus'; at: number; stop: SavedStop }
    | null
  /** Its place in the overlay's order (-1: not in it) and its custom name. */
  orderAt: number
  label: string | null
  /** False when this device's storage refused the change (it shows only until the page is reloaded). */
  kept: boolean
}

type Overlay = Pick<PrefsStore, 'read' | 'write'>

const raw = (s: () => Storage, key: string) => {
  try {
    return s().getItem(key)
  } catch {
    return null
  }
}

/** Bus My stops as storage itself holds them (storage.ts also keeps a copy in memory, even when a write was refused). */
function busStored(): unknown[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BUS_KEYS.SAVED) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return null
  }
}
const busHas = (id: string) => busStored()?.some((s) => (s as SavedStop | null)?.id === id) ?? null

/** Ferry favourites as storage itself holds them; null when it can't be read. */
function ferryStoredHas(f: FerryFavourite): boolean | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FERRY_FAVOURITES) ?? '[]')
    return Array.isArray(v) && v.some((x) => sameFerryFavourite(x as FerryFavourite, f))
  } catch {
    return null
  }
}
const favOf = (item: SavedItem): Favourite => ({ from: item.key, to: item.to })

/** Unsaves the item from its store and the overlay. Never throws: blocked storage gives `kept: false`. */
export function removeSaved(item: SavedItem, overlay: Overlay): Removal {
  let entry: Removal['entry'] = null
  let kept = true
  if (item.mode === 'ferry') {
    const list = readFerryFavourites()
    const at = list.findIndex((f) => sameFerryFavourite(f, favOf(item)))
    if (at >= 0) {
      const local = raw(() => localStorage, STORAGE_KEYS.SELECTED_STOPS)
      const remember = raw(() => localStorage, STORAGE_KEYS.REMEMBER_SELECTION)
      const fav = list[at] as FerryFavourite
      // Removing the remembered pair's favourite forgets that pair too (favourites.ts).
      removeFerryFavourite(fav)
      const forgot = local != null && raw(() => localStorage, STORAGE_KEYS.SELECTED_STOPS) == null
      entry = { mode: 'ferry', at, fav, forgot: forgot ? { local, remember } : null }
      kept = ferryStoredHas(fav) === false
    }
  } else if (item.mode === 'train') {
    const list = readFavourites()
    const at = list.findIndex((f) => sameFavourite(f, favOf(item)))
    if (at >= 0) {
      entry = { mode: 'train', at, fav: list[at] as Favourite }
      writeFavourites(list.filter((_, i) => i !== at))
      kept = !readFavourites().some((f) => sameFavourite(f, favOf(item)))
    }
  } else {
    const list = readSaved()
    const at = list.findIndex((s) => s.id === item.key)
    if (at >= 0) {
      entry = { mode: 'bus', at, stop: list[at] as SavedStop }
      writeSaved(list.filter((_, i) => i !== at))
      kept = busHas(item.key) === false
    }
  }
  const prefs = overlay.read()
  const orderAt = prefs.order.indexOf(item.id)
  const label = Object.hasOwn(prefs.labels, item.id) ? (prefs.labels[item.id] as string) : null
  if (orderAt >= 0 || label != null) {
    const labels = Object.fromEntries(Object.entries(prefs.labels).filter(([id]) => id !== item.id))
    kept = overlay.write({ ...prefs, order: prefs.order.filter((id) => id !== item.id), labels }) && kept
  }
  return { item, entry, orderAt, label, kept }
}

const insert = <T>(list: T[], at: number, it: T) => [...list.slice(0, at), it, ...list.slice(at)]

/** Undo: the store entry back at its place, and the overlay place and name. False if storage refused any of it. */
export function restoreSaved(r: Removal, overlay: Overlay): boolean {
  const { item, entry } = r
  let kept = true
  if (entry?.mode === 'ferry') {
    // Back at its place; the remembered pair the delete forgot comes back too, unless a pair has been remembered since.
    if (!isFerryFavourite(entry.fav)) addFerryFavourite(entry.fav, entry.at)
    const { forgot } = entry
    if (forgot && raw(() => localStorage, STORAGE_KEYS.SELECTED_STOPS) == null) {
      try {
        localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, forgot.local)
        if (forgot.remember == null) localStorage.removeItem(STORAGE_KEYS.REMEMBER_SELECTION)
        else localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, forgot.remember)
      } catch {
        // Storage blocked: checked below.
      }
      writePairCookie()
    }
    kept = ferryStoredHas(entry.fav) === true
  } else if (entry?.mode === 'train') {
    const list = readFavourites()
    if (!list.some((f) => sameFavourite(f, entry.fav))) {
      // A full list (saved to elsewhere since) would lose its last favourite: leave it as it is.
      if (list.length >= MAX_FAVOURITES) return false
      writeFavourites(insert(list, Math.min(entry.at, list.length), entry.fav))
    }
    kept = readFavourites().some((f) => sameFavourite(f, entry.fav))
  } else if (entry?.mode === 'bus') {
    const list = readSaved()
    if (!list.some((s) => s.id === entry.stop.id))
      writeSaved(insert(list, Math.min(entry.at, list.length), entry.stop))
    kept = busHas(entry.stop.id) === true
  }
  if (r.orderAt >= 0 || r.label != null) {
    const prefs = overlay.read()
    const order = prefs.order.filter((id) => id !== item.id)
    const labels = { ...prefs.labels }
    if (r.label != null) labels[item.id] = r.label
    kept =
      overlay.write({
        ...prefs,
        order: r.orderAt >= 0 ? insert(order, Math.min(r.orderAt, order.length), item.id) : order,
        labels,
      }) && kept
  }
  return kept
}
