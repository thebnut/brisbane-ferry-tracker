/**
 * My Transit's own order and names for saved items (THE-114), kept apart from the lists they come from: each mode's
 * store (ferry pair, train favourites, bus My stops) stays in the format its standalone app reads, and this overlay,
 * keyed by SavedItem.id, only says where each item goes and what it's called here.
 *  - No overlay: the list is exactly the default order (ferry, train, bus) with the stores' own names.
 *  - Items not in `order` (saved since) go at the end, in the default order.
 *  - Entries for items no longer saved are ignored; a few labels are kept, so a stop saved again keeps its name.
 * Stored versioned (`v`); older shapes go through MIGRATIONS one step at a time, then are written back as current.
 * Saving lives in saved-prefs-save.ts, which only the editor (its own chunk) loads.
 */

import { safe } from './storage.ts'

export const PREFS_KEY = 'bft-mytransit-prefs'
export const PREFS_VERSION = 1
/** Longest custom name, in characters. */
export const LABEL_MAX = 40
const ORDER_MAX = 500

export interface SavedPrefs {
  v: typeof PREFS_VERSION
  /** SavedItem ids in the visitor's order. */
  order: string[]
  /** Custom names by SavedItem id. */
  labels: Record<string, string>
}

export const EMPTY_PREFS: SavedPrefs = { v: PREFS_VERSION, order: [], labels: {} }

/** A custom name as stored and shown: one line of plain text, spaces collapsed, at most LABEL_MAX characters. */
export function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const flat = raw.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ')
  return Array.from(flat.trim()).slice(0, LABEL_MAX).join('').trim()
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The current shape from anything stored, dropping whatever doesn't fit it. */
function sanitise(order: unknown, labels: unknown): SavedPrefs {
  const ids = Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : []
  const named = isRecord(labels)
    ? Object.entries(labels)
        .map(([id, l]) => [id, cleanLabel(l)] as const)
        .filter(([, l]) => l !== '')
    : []
  // fromEntries defines own properties, so an id such as "__proto__" stays plain data.
  return { v: PREFS_VERSION, order: [...new Set(ids)].slice(0, ORDER_MAX), labels: Object.fromEntries(named) }
}

/**
 * One step per stored version, each taking that version's shape to the next one's. v0 is the unversioned form (a
 * bare list of ids, or `{order, labels}` without `v`); none was ever written, but it shows how a later v2 slots in:
 * add `1: (p) => ({ ...p, v: 2, … })`, bump PREFS_VERSION and the SavedPrefs type.
 */
const MIGRATIONS: Record<number, (p: unknown) => unknown> = {
  0: (p) => (Array.isArray(p) ? { v: 1, order: p, labels: {} } : { ...(p as object), v: 1 }),
}

const versionOf = (p: unknown): number =>
  Array.isArray(p) ? 0 : isRecord(p) ? (typeof p.v === 'number' ? p.v : 0) : -1

/** Stored prefs in the current shape, and whether they had to change to get there (so they're written back). */
export function migratePrefs(stored: unknown): { prefs: SavedPrefs; migrated: boolean } {
  let p = stored
  let v = versionOf(p)
  // Nothing stored, or nothing usable (including a version from the future, which this code can't read).
  if (v < 0 || v > PREFS_VERSION) return { prefs: EMPTY_PREFS, migrated: false }
  const from = v
  while (v < PREFS_VERSION) {
    const step = MIGRATIONS[v]
    if (!step) return { prefs: EMPTY_PREFS, migrated: false }
    p = step(p)
    v = versionOf(p)
  }
  const r = p as Record<string, unknown>
  return { prefs: sanitise(r.order, r.labels), migrated: from !== PREFS_VERSION }
}

/** The overlay on this device (empty when there is none or storage is blocked); an older one is upgraded in place. */
export function readPrefs(): SavedPrefs {
  const raw = safe(() => localStorage.getItem(PREFS_KEY), null)
  if (raw == null) return EMPTY_PREFS
  const { prefs, migrated } = migratePrefs(safe(() => JSON.parse(raw) as unknown, null))
  if (migrated) writePrefs(prefs)
  return prefs
}

/** False when storage is blocked or full (the change still shows until the page is reloaded). */
export function writePrefs(prefs: SavedPrefs): boolean {
  return safe(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    return true
  }, false)
}

/**
 * The saved items in the visitor's order with their custom names (`label`), from the default list. Entries for items
 * that aren't in the list are ignored; items not in the order keep their default order after the rest (a stable sort).
 */
export function applyPrefs<T extends { id: string; label?: string }>(items: T[], prefs: SavedPrefs): T[] {
  const rank = (id: string) => {
    const i = prefs.order.indexOf(id)
    return i < 0 ? ORDER_MAX : i
  }
  return [...items]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((item) => {
      const label = Object.hasOwn(prefs.labels, item.id) && prefs.labels[item.id]
      return label ? { ...item, label } : item
    })
}
