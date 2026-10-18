import { isDemoSession } from '@bft/ui/demo'
/**
 * Saved (X-Home): one list mixing what each standalone app already saves on this device, read with that app's own
 * storage code, so a trip saved in the Ferry, Train or Bus tab shows up here with no second copy:
 *  - ferry: the remembered terminal pair (brisbane-ferry-selected-stops), outbound direction
 *  - train: favourites (bft-train-favourites), station or station → station
 *  - bus: My stops (bft-bus-saved)
 * Offline, each card shows scheduled times from the newest copy kept on the device ("Offline · scheduled"): this
 * page's own copy first, else the copy the mode's own page keeps.
 */

import { stopHref } from '@bft/bus/app/lib/stops.ts'
import { readOffline as readBusOffline, readSaved as readBusSaved } from '@bft/bus/app/lib/storage.ts'
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { cleanStopName } from '@bft/ferry/app/lib/names.ts'
import { readOffline as readFerryOffline, readSavedPair } from '@bft/ferry/app/lib/storage.ts'
import { terminalById } from '@bft/ferry/app/lib/terminals.ts'
import { readFavourites, readOfflineDay } from '@bft/train/app/lib/storage.ts'
import { timetableStatus } from '@bft/ui/connectivity'
import { stationName, trainBoardHref } from './hrefs.ts'
import { MODE_BASES } from './modes.ts'
import { safe } from './storage.ts'

export interface SavedItem {
  /** Stable id across reloads, e.g. "bus:1832". */
  id: string
  mode: 'ferry' | 'train' | 'bus'
  /** Board stop key (/v1/{mode}/stops/{key}/departures) and optional destination key. */
  key: string
  to: string | null
  title: string
  href: string
}

export function readSavedItems(): SavedItem[] {
  const out: SavedItem[] = []
  const pair = readSavedPair()
  if (pair) {
    const from = terminalById(pair.outbound.id)
    const to = terminalById(pair.inbound.id)
    out.push({
      id: `ferry:${pair.outbound.id}>${pair.inbound.id}`,
      mode: 'ferry',
      key: pair.outbound.id,
      to: pair.inbound.id,
      title: `${cleanStopName(from?.name ?? pair.outbound.name)} → ${cleanStopName(to?.name ?? pair.inbound.name)}`,
      href: MODE_BASES.ferry,
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
