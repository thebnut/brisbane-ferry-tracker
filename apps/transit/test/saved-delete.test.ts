// @vitest-environment jsdom
import { KEYS, readSaved, writeSaved } from '@bft/bus/app/lib/storage.ts'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { FAVOURITES_KEY } from '@bft/train/app/lib/storage.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSavedItems as readDefault, type SavedItem } from '../app/lib/saved.ts'
import { removeSaved, restoreSaved } from '../app/lib/saved-delete.ts'
import {
  applyPrefs,
  cleanLabel,
  LABEL_MAX,
  PREFS_KEY,
  readPrefs,
  writePrefs,
} from '../app/lib/saved-prefs.ts'

const store = { read: readPrefs, write: writePrefs, clean: cleanLabel, maxLength: LABEL_MAX }
/** What My Transit lists. */
const shown = () => applyPrefs(readDefault(), readPrefs())
const ids = (list: Array<{ id: string }>) => list.map((i) => i.id)
const byId = (id: string) => shown().find((i) => i.id === id) as SavedItem

const FERRY = 'ferry:317584>317590'
const PAIR = JSON.stringify({
  outbound: { id: '317584', name: 'Bulimba' },
  inbound: { id: '317590', name: 'Riverside' },
})
const BUS = [
  { id: '1832', name: 'Cultural Centre, platform 1' },
  { id: '10795', name: 'Queen Street station' },
  { id: '10802', name: 'Cultural Centre station, platform 1' },
]
const TRAINS = [
  { from: 'central', to: null },
  { from: 'roma-street', to: 'indooroopilly' },
  { from: 'bowen-hills', to: null },
]
const ORDER = [
  'bus:10795',
  'train:roma-street>indooroopilly',
  FERRY,
  'bus:1832',
  'train:central>',
  'bus:10802',
  'train:bowen-hills>',
]
const LABELS = { 'bus:10795': 'Work', 'train:roma-street>indooroopilly': 'Home run', [FERRY]: 'Ferry home' }

function seed({ overlay = true } = {}) {
  localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, PAIR)
  localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify(TRAINS))
  // Through the store, so its in-memory copy matches.
  writeSaved(BUS)
  if (overlay) writePrefs({ v: 1, order: ORDER, labels: LABELS })
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('deleting a saved item from My Transit (THE-115)', () => {
  it('bus: leaves bft-bus-saved and the overlay; Undo puts the stop, its place, order and name back', () => {
    seed()
    const before = shown()
    const r = removeSaved(byId('bus:10795'), store)
    expect(r.kept).toBe(true)
    expect(stored(KEYS.SAVED)).toEqual([BUS[0], BUS[2]])
    expect(readSaved()).toEqual([BUS[0], BUS[2]])
    expect(readPrefs().order).toEqual(ORDER.filter((id) => id !== 'bus:10795'))
    expect(readPrefs().labels).not.toHaveProperty('bus:10795')
    expect(ids(shown())).not.toContain('bus:10795')
    expect(restoreSaved(r, store)).toBe(true)
    expect(stored(KEYS.SAVED)).toEqual(BUS)
    expect(readPrefs()).toEqual({ v: 1, order: ORDER, labels: LABELS })
    expect(shown()).toEqual(before)
  })

  it('train: leaves bft-train-favourites (and its cookie) and the overlay; Undo restores it all', () => {
    seed()
    const before = shown()
    const r = removeSaved(byId('train:roma-street>indooroopilly'), store)
    expect(r.kept).toBe(true)
    expect(stored(FAVOURITES_KEY)).toEqual([TRAINS[0], TRAINS[2]])
    expect(document.cookie).toContain('bft_fav=central.%2Cbowen-hills.')
    expect(readPrefs().order).not.toContain('train:roma-street>indooroopilly')
    expect(readPrefs().labels).not.toHaveProperty('train:roma-street>indooroopilly')
    expect(restoreSaved(r, store)).toBe(true)
    expect(stored(FAVOURITES_KEY)).toEqual(TRAINS)
    expect(readPrefs()).toEqual({ v: 1, order: ORDER, labels: LABELS })
    expect(shown()).toEqual(before)
  })

  it('ferry: unsaves the pair (remembered, its flag and cookie) and the overlay; Undo restores exactly that', () => {
    seed()
    const before = shown()
    const r = removeSaved(byId(FERRY), store)
    expect(r.kept).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)).toBeNull()
    expect(document.cookie).not.toContain('bft_pair=317584')
    expect(ids(shown())).not.toContain(FERRY)
    expect(restoreSaved(r, store)).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBe(PAIR)
    expect(localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)).toBe('true')
    expect(document.cookie).toContain('bft_pair=317584.317590')
    expect(readPrefs()).toEqual({ v: 1, order: ORDER, labels: LABELS })
    expect(shown()).toEqual(before)
  })

  it("ferry: a pair kept for this session only comes back as this session's, not remembered", () => {
    sessionStorage.setItem(STORAGE_KEYS.SELECTED_STOPS_SESSION, PAIR)
    const r = removeSaved(byId(FERRY), store)
    expect(sessionStorage.getItem(STORAGE_KEYS.SELECTED_STOPS_SESSION)).toBeNull()
    expect(restoreSaved(r, store)).toBe(true)
    expect(sessionStorage.getItem(STORAGE_KEYS.SELECTED_STOPS_SESSION)).toBe(PAIR)
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)).toBeNull()
  })

  it('an item missing from the overlay (no overlay at all) leaves it unwritten; Undo puts the store place back', () => {
    seed({ overlay: false })
    const before = ids(shown())
    const r = removeSaved(byId('bus:1832'), store)
    expect(r).toMatchObject({ orderAt: -1, label: null, kept: true })
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
    expect(stored(KEYS.SAVED)).toEqual([BUS[1], BUS[2]])
    restoreSaved(r, store)
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
    expect(stored(KEYS.SAVED)).toEqual(BUS)
    expect(ids(shown())).toEqual(before)
  })

  it('an item saved since the overlay was written (not in its order) leaves the order as it was', () => {
    seed()
    writePrefs({ v: 1, order: ORDER.filter((id) => id !== 'bus:10802'), labels: LABELS })
    const prefs = readPrefs()
    const r = removeSaved(byId('bus:10802'), store)
    expect(r.orderAt).toBe(-1)
    expect(readPrefs()).toEqual(prefs)
    restoreSaved(r, store)
    expect(readPrefs()).toEqual(prefs)
    expect(stored(KEYS.SAVED)).toEqual(BUS)
  })

  it('an item its store no longer has (unsaved in another tab) still leaves the overlay, and Undo brings back only that', () => {
    seed()
    const item = byId('bus:10795')
    writeSaved([BUS[0] as (typeof BUS)[0], BUS[2] as (typeof BUS)[0]])
    const r = removeSaved(item, store)
    expect(r.entry).toBeNull()
    expect(readPrefs().order).not.toContain('bus:10795')
    restoreSaved(r, store)
    expect(readPrefs().labels['bus:10795']).toBe('Work')
    expect(stored(KEYS.SAVED)).toEqual([BUS[0], BUS[2]])
  })

  it('a second delete, then Undo of it, leaves the first deleted', () => {
    seed()
    removeSaved(byId('bus:1832'), store)
    const second = removeSaved(byId('train:central>'), store)
    restoreSaved(second, store)
    expect(ids(shown())).not.toContain('bus:1832')
    expect(ids(shown())).toContain('train:central>')
    expect(stored(FAVOURITES_KEY)).toEqual(TRAINS)
  })

  it('blocked storage: no crash, and the delete and Undo report that nothing was kept', () => {
    seed()
    const item = byId('bus:10795')
    const train = byId('train:central>')
    const ferry = byId(FERRY)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    for (const it of [item, train, ferry]) {
      const r = removeSaved(it, store)
      expect(r.kept, it.id).toBe(false)
      expect(() => restoreSaved(r, store)).not.toThrow()
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const r = removeSaved(item, store)
    expect(r.kept).toBe(false)
    expect(restoreSaved(r, store)).toBe(false)
  })
})
