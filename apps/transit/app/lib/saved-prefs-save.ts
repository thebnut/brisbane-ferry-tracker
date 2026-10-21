/**
 * Saving My Transit's order and names (THE-114), loaded with the editor only: the page itself just reads them
 * (saved-prefs.ts), so this stays off its first load.
 */

// Types only: a value import would pull saved-prefs.ts out of the page's chunk into one shared with this.
import type { SavedPrefs } from './saved-prefs.ts'

/** Labels kept for items that aren't saved any more (so one saved again keeps its name). */
const STALE_LABELS_MAX = 50

/** What the editor needs from saved-prefs.ts, passed in so that module stays in the page's own chunk. */
export interface PrefsStore {
  read: () => SavedPrefs
  write: (prefs: SavedPrefs) => boolean
  clean: (raw: unknown) => string
  maxLength: number
}

/**
 * The overlay for a list as now shown: its order, and its names plus a few for items no longer saved (the newest
 * kept, so re-saving one brings its name back). Ids no longer saved leave the order.
 */
export function prefsFor(
  items: ReadonlyArray<{ id: string; label?: string }>,
  prev: SavedPrefs,
  clean: PrefsStore['clean'],
): SavedPrefs {
  const ids = new Set(items.map((i) => i.id))
  const stale = Object.entries(prev.labels)
    .filter(([id]) => !ids.has(id))
    .slice(-STALE_LABELS_MAX)
  const own = items.map((i) => [i.id, clean(i.label)] as const).filter(([, l]) => l !== '')
  return {
    // `read` gives the current version (migrated if it had to be).
    v: prev.v,
    order: items.map((i) => i.id),
    labels: Object.fromEntries([...stale, ...own]),
  }
}

/** Saves the list's order and names; false when storage is blocked. */
export function savePrefs(items: ReadonlyArray<{ id: string; label?: string }>, store: PrefsStore): boolean {
  return store.write(prefsFor(items, store.read(), store.clean))
}
