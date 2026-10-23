/**
 * Ferry favourites (THE-118 PR 1): as many terminal trips as the rider likes, `{from, to|null}` in
 * `bft-ferry-favourites`, saved with the board's star and read by My Transit. Not on the boards' first load: the star
 * loads it after hydration (FerryStar.tsx).
 *
 * - **Migration:** the first read on a device that has no list yet seeds it once from the remembered pair
 *   (`brisbane-ferry-selected-stops`), but only when "Remember selection" was on. A pair kept for this session only
 *   is never a favourite. Malformed or blocked storage reads as an empty list and never throws.
 * - **The remembered pair stays** for the standalone app's stop selector: remembering a pair there also makes it a
 *   favourite (save-pair.ts), and unsaving a favourite that is the remembered pair forgets that pair too, so the board
 *   doesn't keep opening on a trip the rider took out.
 * - **Cookie:** `bft_pair` holds the first favourite (storage.ts favouriteCookie), so ferry home's headline is in the
 *   server HTML (THE-118 PR 8), as bus mirrors its first stops. Only a favourite: a pair kept for this session alone
 *   never gets there.
 */

import { favouriteCookie, PAIR_COOKIE, STORAGE_KEYS } from './storage.ts'
import { type StopPair, terminalById } from './terminals.ts'

export const FAVOURITES_KEY = 'bft-ferry-favourites'
/** Fired on `window` after the list is written. */
export const FAVOURITES_EVENT = 'bft-ferry-favourites'

export interface FerryFavourite {
  from: string
  to: string | null
}

export const sameFerryFavourite = (a: FerryFavourite, b: FerryFavourite) =>
  a.from === b.from && (a.to ?? null) === (b.to ?? null)

/** Known terminals only, a "To" the origin reaches directly (else none), each trip once. */
export function cleanFavourites(list: unknown): FerryFavourite[] {
  if (!Array.isArray(list)) return []
  const out: FerryFavourite[] = []
  for (const f of list) {
    const from = (f as FerryFavourite | null)?.from
    const to = (f as FerryFavourite | null)?.to ?? null
    const origin = typeof from === 'string' ? terminalById(from) : null
    if (!origin) continue
    const fav = {
      from: origin.id,
      to: typeof to === 'string' && origin.destinations.includes(to) ? to : null,
    }
    if (!out.some((x) => sameFerryFavourite(x, fav))) out.push(fav)
  }
  return out
}

const parse = (raw: string | null): unknown => {
  try {
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/** The pair "Remember selection" kept, as a favourite; null when remember was off or there is none. */
function rememberedFavourite(): FerryFavourite | null {
  try {
    if (localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION) !== 'true') return null
    const p = parse(localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS)) as StopPair | null
    const from = p?.outbound?.id
    const to = p?.inbound?.id
    return typeof from === 'string' && typeof to === 'string'
      ? (cleanFavourites([{ from, to }])[0] ?? null)
      : null
  } catch {
    return null
  }
}

/** The favourites, migrating once from the remembered pair. Blocked storage: none. */
export function readFerryFavourites(): FerryFavourite[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(FAVOURITES_KEY)
  } catch {
    return []
  }
  if (raw != null) return cleanFavourites(parse(raw))
  const seed = rememberedFavourite()
  const list = seed ? [seed] : []
  // Written even when empty, so a pair remembered later doesn't seed it again (save-pair.ts adds that one itself).
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(list))
  } catch {
    // Refused: read again next time.
  }
  return list
}

/** `bft_pair` for SSR: the first favourite, ferry home's headline; none clears it. */
export function writePairCookie(list: FerryFavourite[] = readFerryFavourites()): void {
  const first = list[0]
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in Safari; this is a plain preference cookie.
    document.cookie = `${PAIR_COOKIE}=${first ? favouriteCookie(first) : ''}; path=/; samesite=lax; max-age=${first ? 31536000 : 0}`
  } catch {
    // Cookies blocked: the server renders ferry home without its headline, and the page adds it.
  }
}

/** Saves the list (and the cookie). False when storage refused it. */
export function writeFerryFavourites(list: FerryFavourite[]): boolean {
  const next = cleanFavourites(list)
  let kept = true
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next))
  } catch {
    kept = false
  }
  // The cookie follows what storage holds: after a refused write (quota) the next ferry home would otherwise head with
  // a trip that was never saved (release review of c1f2be0).
  writePairCookie(kept ? next : readFerryFavourites())
  // Every star and list on this page reads it again (FerryStar); other tabs get the storage event.
  try {
    dispatchEvent(new Event(FAVOURITES_EVENT))
  } catch {
    // No window (tests without a DOM): nothing on the page to tell.
  }
  return kept
}

/** Forgets the remembered pair when it is this favourite (the selector's "Remember selection" with it). */
function forgetRemembered(f: FerryFavourite): void {
  const r = rememberedFavourite()
  if (!r || !sameFerryFavourite(r, f)) return
  try {
    localStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS)
    localStorage.removeItem(STORAGE_KEYS.REMEMBER_SELECTION)
  } catch {
    // Blocked: nothing was remembered here.
  }
}

/** Adds the trip (at the end, or `at`) unless it is saved already. Returns the list as it is now. */
export function addFerryFavourite(f: FerryFavourite, at?: number): FerryFavourite[] {
  const list = readFerryFavourites()
  if (list.some((x) => sameFerryFavourite(x, f))) return list
  const i = at == null ? list.length : Math.max(0, Math.min(at, list.length))
  writeFerryFavourites([...list.slice(0, i), f, ...list.slice(i)])
  return readFerryFavourites()
}

/** Takes the trip out (and the remembered pair, when it is that trip). Returns the list as it is now. */
export function removeFerryFavourite(f: FerryFavourite): FerryFavourite[] {
  const list = readFerryFavourites()
  forgetRemembered(f)
  writeFerryFavourites(list.filter((x) => !sameFerryFavourite(x, f)))
  return readFerryFavourites()
}

export const isFerryFavourite = (f: FerryFavourite, list = readFerryFavourites()) =>
  list.some((x) => sameFerryFavourite(x, f))
