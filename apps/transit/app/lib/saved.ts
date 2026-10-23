import { isDemoSession } from '@bft/ui/demo'
/**
 * Saved (X-Home): one list mixing what each standalone app already saves on this device, read with that app's own
 * storage code, so a trip saved in the Ferry, Train or Bus tab shows up here with no second copy:
 *  - ferry: favourites (bft-ferry-favourites, THE-118), terminal or terminal → terminal, read as ferry favourites.ts
 *    reads them (readFerry below)
 *  - train: favourites (bft-train-favourites), station or station → station
 *  - bus: My stops (bft-bus-saved)
 * Offline, each card shows scheduled times from the newest copy kept on the device ("Offline · scheduled"): this
 * page's own copy first, else the copy the mode's own page keeps.
 * My Transit applies the visitor's own order and names on top (saved-prefs.ts, THE-114); this is the default list.
 */

import { stopHref } from '@bft/bus/app/lib/stops.ts'
import { readOffline as readBusOffline, readSaved as readBusSaved } from '@bft/bus/app/lib/storage.ts'
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { cleanStopName } from '@bft/ferry/app/lib/names.ts'
import { STORAGE_KEYS as FERRY_KEYS, readOffline as readFerryOffline } from '@bft/ferry/app/lib/storage.ts'
import { boardHref as ferryBoardHref, terminalById } from '@bft/ferry/app/lib/terminals.ts'
import { readFavourites, readOfflineDay } from '@bft/train/app/lib/storage.ts'
import { timetableStatus } from '@bft/ui/connectivity'
import { stationName, trainBoardHref } from './hrefs.ts'
import { safe } from './storage.ts'

export interface SavedItem {
  /** Stable id across reloads, e.g. "bus:1832". */
  id: string
  mode: 'ferry' | 'train' | 'bus'
  /** Board stop key (/v1/{mode}/stops/{key}/departures) and optional destination key. */
  key: string
  to: string | null
  /** The stores' own name for it. */
  title: string
  /** The visitor's own name for it on My Transit (saved-prefs.ts applyPrefs), shown instead of `title`. */
  label?: string
  href: string
}

type FerryFavourite = { from: string; to: string | null }

/**
 * Ferry favourites exactly as ferry favourites.ts readFerryFavourites returns them, read here without that module: it
 * would bring the favourites' write code onto every transit page's first load (test/saved.test.ts checks the two
 * agree). Before the list exists, the pair "Remember selection" kept, which favourites.ts makes the first favourite on
 * its first read (only then is the list written).
 */
export function readFerry(): FerryFavourite[] {
  const raw = safe<string | null | undefined>(() => localStorage.getItem('bft-ferry-favourites'), undefined)
  let list: unknown = null
  if (raw === null) {
    const p = safe(
      () =>
        localStorage.getItem(FERRY_KEYS.REMEMBER_SELECTION) === 'true' &&
        JSON.parse(localStorage.getItem(FERRY_KEYS.SELECTED_STOPS) ?? 'null'),
      null,
    )
    if (typeof p?.outbound?.id === 'string' && typeof p.inbound?.id === 'string')
      list = [{ from: p.outbound.id, to: p.inbound.id }]
  } else if (raw) list = safe(() => JSON.parse(raw), null)
  const out: FerryFavourite[] = []
  for (const f of Array.isArray(list) ? list : []) {
    const origin = typeof f?.from === 'string' ? terminalById(f.from) : null
    if (!origin) continue
    const to = typeof f.to === 'string' && origin.destinations.includes(f.to) ? (f.to as string) : null
    if (!out.some((x) => x.from === origin.id && x.to === to)) out.push({ from: origin.id, to })
  }
  return out
}

/** Ferry favourites, then train favourites, then bus stops, each in its own store's order. */
export function readSavedItems(): SavedItem[] {
  const out: SavedItem[] = []
  for (const f of readFerry()) {
    const from = terminalById(f.from)
    const to = f.to ? terminalById(f.to) : null
    if (!from) continue
    out.push({
      // The remembered pair's id before THE-118 too, so its My Transit name and place carry over.
      id: `ferry:${f.from}>${f.to ?? ''}`,
      mode: 'ferry',
      key: f.from,
      to: f.to,
      title: to ? `${cleanStopName(from.name)} → ${cleanStopName(to.name)}` : cleanStopName(from.name),
      // The terminal's board, with "To" set (THE-118 PR 5).
      href: ferryBoardHref(f.from, f.to),
    })
  }
  for (const f of readFavourites())
    out.push({
      id: `train:${f.from}>${f.to ?? ''}`,
      mode: 'train',
      key: f.from,
      to: f.to,
      title: f.to ? `${stationName(f.from)} → ${stationName(f.to)}` : stationName(f.from),
      href: trainBoardHref(f.from, f.to),
    })
  for (const s of readBusSaved())
    out.push({ id: `bus:${s.id}`, mode: 'bus', key: s.id, to: null, title: s.name, href: stopHref(s.id) })
  return out
}

// ---- offline copies ----

const OFFLINE_PREFIX = 'bft-transit-v1:'

/** This page's own copy of a card's last good response (20 rows), for offline. */
export function writeSavedCopy(item: SavedItem, res: DeparturesResponse): void {
  // A visitor's demo session keeps nothing on the device (R7-B1).
  if (isDemoSession()) return
  safe(() => localStorage.setItem(`${OFFLINE_PREFIX}${item.id}`, JSON.stringify(res)), undefined)
}

function readCopy(item: SavedItem): Departure[] | null {
  const own = safe(
    () =>
      JSON.parse(localStorage.getItem(`${OFFLINE_PREFIX}${item.id}`) ?? 'null') as DeparturesResponse | null,
    null,
  )
  if (Array.isArray(own?.departures)) return own.departures
  if (item.mode === 'bus') {
    const body = readBusOffline(item.key)?.body as DeparturesResponse | undefined
    return Array.isArray(body?.departures) ? body.departures : null
  }
  if (item.mode === 'train') return readOfflineDay(item.key, item.to)?.departures ?? null
  const body = readFerryOffline(item.key, item.to ?? '') as DeparturesResponse | null
  return Array.isArray(body?.departures) ? body.departures : null
}

/**
 * Scheduled-only rows for a saved item from the device's copies, without departures that have gone: no live
 * estimates or GPS are ever shown from a copy.
 */
export function offlineRows(item: SavedItem, nowMs: number): Departure[] | null {
  const rows = readCopy(item)
  return rows ? asScheduled(rows, nowMs) : null
}

/** Rows as timetable only (no estimates, no GPS), dropping those that have gone. */
export function asScheduled(rows: Departure[], nowMs: number): Departure[] {
  const cutoff = nowMs / 1000 - 60
  return rows
    .filter((d) => d.schedDep >= cutoff)
    .sort((a, b) => a.schedDep - b.schedDep)
    .map((d) => ({
      ...d,
      // Cancelled, skipped and unknown stay as they are (never boardable); live becomes timetable only.
      status: timetableStatus(d.status),
      estDep: null,
      estArrTo: null,
      gps: false,
    }))
}
