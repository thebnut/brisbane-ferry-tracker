/** Links into the mode tabs from transit pages, without loading a mode's station or stop lists. */
import { stopHref } from '@bft/bus/app/lib/stops.ts'
import { terminalById, terminalHref } from '@bft/ferry/app/lib/terminals.ts'
import { at as trainAt } from '@bft/train/app/lib/base.ts'
import { MODE_BASES } from './modes.ts'
import type { NearbyMode } from './nearby.ts'

/**
 * "roma-street" → "Roma Street": train keys are station-name slugs, so a title needs no station list on the home page
 * (the train network file is 8 KB gz; the cards show the API's names once departures load).
 */
export const stationName = (k: string) => k.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
/** Same path as the train app's stationHref (checked in test/saved.test.ts), without loading its station list. */
export const trainBoardHref = (from: string, to: string | null) =>
  `${trainAt(`/station/${from}`)}${to ? `?to=${to}` : ''}`

/** The mode page for a stop: ferry terminal page, train station board, bus stop board. */
export function stopPageHref(mode: NearbyMode, key: string): string {
  if (mode === 'train') return trainBoardHref(key, null)
  if (mode === 'bus') return stopHref(key)
  const t = terminalById(key)
  return t ? terminalHref(t.slug) : MODE_BASES.ferry
}
