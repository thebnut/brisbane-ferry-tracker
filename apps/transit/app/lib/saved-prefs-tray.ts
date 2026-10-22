/**
 * A re-run of the onboarding picker (THE-113) and My Transit's own order (THE-114): after a successful Save, the stops
 * that were in the tray take the tray's order in the overlay, so My Transit shows what the tray showed. Only the
 * picker loads this (OnboardingPicker.tsx). It reads and writes the overlay itself and imports nothing from
 * saved-prefs.ts (or storage.ts): a value import, even a dynamic one, splits that module out of the `/` page's chunk
 * into a shared one its first load then has to fetch.
 * The standalone mode apps run on their own origins and can't reach this storage, so this is BrisbaneTransit only.
 */

import type { TrayItem } from '@bft/ui/onboarding'

/** saved-prefs.ts PREFS_KEY and PREFS_VERSION (test/saved-prefs-tray.test.ts checks they match). */
export const OVERLAY_KEY = 'bft-mytransit-prefs'
export const OVERLAY_VERSION = 1

/** The SavedItem id (saved.ts readSavedItems) of a tray item: a ferry pair, a train station, a bus stop. */
export function savedId(item: Pick<TrayItem, 'mode' | 'id' | 'to'>): string {
  if (item.mode === 'ferry') return `ferry:${item.id}>${item.to ?? ''}`
  // The tray only has stations; a favourite trip with a destination stays out of it (trainTrayItems).
  if (item.mode === 'train') return `train:${item.id}>`
  return `bus:${item.id}`
}

/**
 * The overlay's order after a re-run. Every place held by a tray item (one there before the re-run or after it) is
 * filled, in turn, by the tray's items in the tray's order; items the tray never had (train trips, items saved
 * elsewhere) keep their places. Tray items beyond those places (newly added) go at the end, still in tray order; a
 * place left over (a stop taken out) goes.
 */
export function trayOrder(
  order: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string[] {
  const tray = new Set([...before, ...after])
  const out: string[] = []
  let next = 0
  for (const id of order) {
    if (!tray.has(id)) out.push(id)
    else if (next < after.length) out.push(after[next++] as string)
  }
  return [...out, ...after.slice(next)]
}

/**
 * After a re-run's Save: the overlay, if this device has one, takes the tray's order (names and the rest are kept).
 * With no overlay, or one in a shape this code doesn't write (another version), nothing is written; blocked storage
 * changes nothing. saved-prefs.ts readPrefs still checks whatever it reads.
 */
export function keepTrayOrder(before: readonly TrayItem[], after: readonly TrayItem[]): void {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY)
    if (raw == null) return
    const prefs: unknown = JSON.parse(raw)
    if (typeof prefs !== 'object' || prefs === null || Array.isArray(prefs)) return
    const { v, order } = prefs as { v?: unknown; order?: unknown }
    if (v !== OVERLAY_VERSION || !Array.isArray(order) || order.length === 0) return
    const ids = order.filter((id): id is string => typeof id === 'string')
    const next = trayOrder(ids, before.map(savedId), after.map(savedId))
    if (next.join('\n') !== order.join('\n'))
      localStorage.setItem(OVERLAY_KEY, JSON.stringify({ ...prefs, order: next }))
  } catch {
    // Storage blocked or the overlay unreadable: My Transit keeps the order it has.
  }
}
