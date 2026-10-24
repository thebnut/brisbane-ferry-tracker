/**
 * Desktop master–detail (THE-118 PR 7), the part a board's layout needs on its first load. At 1024 px and wider every
 * board is a column of about 640 px beside a 480 px panel (board-grid, board-column and board-panel in theme.css). A
 * row opens its trip in the panel at the trip's own URL, so back closes it and the link can be shared; with no row open
 * the panel shows the return board (a destination is set) or the place's map. Below 1024 a row opens the trip's full
 * page, as before.
 *
 * Each board's route module is a layout over the board URL and the trip URL: the board stays mounted while the panel
 * opens and closes, and its `shouldRevalidate` (samePlace) keeps the board's loader from running again. This module has
 * only that and the width check. The panel itself (its context, ✕ and "Open
 * full page", focus and Esc) is `@bft/ui/panel`, loaded with the trip; its chrome is TripPanelFrame in `@bft/ui/trip`.
 */
import type { LiveState, SeededQuery } from './connectivity.ts'

/** Where the board gets its panel. */
export const WIDE = '(min-width: 1024px)'

/** Client-only: false on the server and wherever matchMedia is missing. */
export const isWide = () => typeof matchMedia === 'function' && matchMedia(WIDE).matches

/** For `useSyncExternalStore(onWide, isWide, notWide)` in a layout: is the board wide enough for its panel? */
export const onWide = (change: () => void) => {
  if (typeof matchMedia !== 'function') return () => {}
  const m = matchMedia(WIDE)
  m.addEventListener('change', change)
  return () => m.removeEventListener('change', change)
}

/** The server's and hydration's answer: not wide, so the first render matches the HTML. */
export const notWide = () => false

/** The full page's search parameter: at desktop width the trip URL is the panel without it. */
export const FULL = 'full'

/**
 * The trip's answer beside the board, as one more board for `pagePending` (R32-RT1): a trip still waiting keeps the
 * header at "Connecting…" only while nothing else has failed or answered not live, and its own failure or non-live
 * answer wins over a board still waiting. `live`: its own answer is live.
 */
export interface PanelState {
  q: SeededQuery & { isError: boolean }
  state: LiveState
  live: boolean
}

/** The board a URL is for: its place, destination and any filter the loader applies (a bus stop's `?route=`). */
export interface Place {
  from: string
  to: string | null
  filter: string | null
  /** A trip URL (the board is the one it was opened from), not the board's own. */
  trip: boolean
}

/**
 * A URL's place as written (`/<segment>/:id?to=&route=`, or a trip's `?from=&to=`): no lookups, so the client's
 * revalidation never loads the places' tables. A link that names one another way (an id for a slug) only costs a loader
 * run.
 */
export function placeOf(url: URL, segment: string): Place | null {
  const own = new RegExp(`/${segment}/([^/]+)$`).exec(url.pathname)?.[1]
  const from = own ? decodeURIComponent(own) : url.searchParams.get('from')
  const q = url.searchParams
  return from ? { from, to: q.get('to'), filter: q.get('route'), trip: !own } : null
}

const pair = (p: Place) => `${p.from}>${p.to ?? ''}`
const either = (p: Place) => [pair(p), p.to ? `${p.to}>${p.from}` : null]

/** The board each layout shows (by its URL segment): a trip URL keeps it, so the trip says nothing about it. */
const shown = new Map<string, Place>()

/**
 * The layout tells which board it shows (its loader's place, as `placeOf` would write it), or null while its data is
 * only a trip URL's placeholder (a trip opened from a link): then leaving the trip for the board runs the board's loader
 * once, for what only it has (the place's own section and meta). Client only.
 */
export function showBoard(segment: string, place: Omit<Place, 'trip'> | null) {
  if (typeof document === 'undefined') return
  if (place) shown.set(segment, { ...place, trip: false })
  else shown.delete(segment)
}

/**
 * A board's layout `shouldRevalidate` (its URL `/<segment>/:id`): its loader runs again only when the board changes
 * (another stop, destination, direction or filter; demo data on or off), not when a trip opens or closes beside it. A
 * trip from the return board (the other way) or beside a filtered board belongs to the board shown; leaving a trip for
 * a board URL is the same board only when it is the one shown (⇄ from beside a trip is a new board).
 */
export function samePlace(
  { currentUrl, nextUrl, formMethod }: { currentUrl: URL; nextUrl: URL; formMethod?: string },
  segment: string,
): boolean {
  if (formMethod && formMethod !== 'GET') return false
  if (currentUrl.href === nextUrl.href) return false
  if (['fixtures', 'rt'].some((k) => currentUrl.searchParams.get(k) !== nextUrl.searchParams.get(k)))
    return false
  const now = placeOf(currentUrl, segment)
  const next = placeOf(nextUrl, segment)
  if (!now || !next) return false
  const board = now.trip ? shown.get(segment) : now
  if (!board) return false
  return next.trip
    ? either(board).includes(pair(next))
    : pair(board) === pair(next) && board.filter === next.filter
}
