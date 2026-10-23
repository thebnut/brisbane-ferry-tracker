/**
 * Desktop master–detail (THE-118 PR 7). At 1024 px and wider every board is a column of about 640 px beside a 480 px
 * panel (board-grid, board-column and board-panel in theme.css). A row opens its trip in the panel at the trip's own
 * URL, so back closes it and the link can be shared; with no row open the panel shows the return board (a destination
 * is set) or the place's map. Below 1024 a row opens the trip's full page, as before.
 *
 * Each board's route module is a layout over the board URL and the trip URL: the board stays mounted while the panel
 * opens and closes, and its `shouldRevalidate` (samePlace) keeps the board's loader from running again. This module is
 * what the layouts and the trip pages share: the panel's controls, its focus and Esc, and the revalidation rule. The
 * boards' rows carry their few desktop props themselves (each app's RowLink): the boards' first load is tight, and
 * BrisbaneFerry's home board has no panel. The panel's chrome is in `@bft/ui/trip` (TripPanelFrame).
 */
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { BOARD_STATE } from './row.tsx'

/** Where the board gets its panel. */
export const WIDE = '(min-width: 1024px)'

/** Client-only: false on the server and wherever matchMedia is missing. */
export const isWide = () => typeof matchMedia === 'function' && matchMedia(WIDE).matches

const subscribe = (change: () => void) => {
  if (typeof matchMedia !== 'function') return () => {}
  const m = matchMedia(WIDE)
  m.addEventListener('change', change)
  return () => m.removeEventListener('change', change)
}

/** Is the board wide enough for its panel? False on the server and while hydrating, so the first render matches. */
export const useWide = () => useSyncExternalStore(subscribe, isWide, () => false)

/** Is `href` the trip page of `tripInstance` (with or without a query)? */
export function isTripHref(href: string, tripInstance: string): boolean {
  return (href.split('?')[0] as string).endsWith(`/trip/${encodeURIComponent(tripInstance)}`)
}

/** What the trip page needs to show itself as the panel: the board's layout provides it. */
export interface Panel {
  /** Close the panel: back to the board (in history when the row opened it). */
  close: () => void
  /** The trip's full page (`?full=1`), replacing the panel in history so its back link returns to the board. */
  openFull: () => void
  fullHref: string
  /** The trip's own answer for the page header, which the board's layout combines with the board's (R32-RT1). */
  report?: (state: PanelState | null) => void
}

/** The trip's answer beside the board: live, or still waiting for its first (or a non-live seed's own) answer. */
export interface PanelState {
  live: boolean
  pending: boolean
}

/**
 * Beside a board, the trip's own answer counts in the page header like any board's: a trip not live, or still waiting,
 * keeps the header from LIVE. Nothing as its own full page (its header is its own).
 */
export function usePanelReport(panel: Panel | null, live: boolean, pending: boolean) {
  const report = panel?.report
  useEffect(() => {
    if (!report) return
    report({ live, pending })
    return () => report(null)
  }, [report, live, pending])
}

/** The page header's answer with the panel's: LIVE only if both are, "Connecting…" while either waits. */
export const withPanel = (live: boolean, pending: boolean, panel: PanelState | null) => ({
  live: live && panel?.live !== false,
  pending: pending || !!panel?.pending,
})

const PanelContext = createContext<Panel | null>(null)
export const PanelProvider = PanelContext.Provider
/** Null: the trip is its own full page. */
export const usePanel = () => useContext(PanelContext)

/** The full page's search parameter: at desktop width the trip URL is the panel without it. */
export const FULL = 'full'

/** `href` (a path with its search) with `?full=1`. */
export function fullHref(href: string): string {
  const [path, search = ''] = href.split('?')
  const q = new URLSearchParams(search)
  q.set(FULL, '1')
  return `${path}?${q}`
}

/** Went back through history when this trip was opened from a board row (or a row while another trip was open). */
export const fromBoardRow = () =>
  typeof (globalThis.history?.state as { usr?: Record<string, unknown> } | null)?.usr?.[BOARD_STATE] ===
  'string'

/**
 * The panel's focus: into the panel when a trip opens (Enter on a row), back to that trip's row when it closes (Esc, ✕
 * or browser back), in the board column or the return board beside it. Esc closes the panel unless a sheet or dialog
 * is open over it.
 */
export function usePanelFocus(open: string | undefined, close: () => void) {
  // A trip opened by a board row's link (also from another page's board, BrisbaneFerry's home) takes the focus too.
  const last = useRef(fromBoardRow() ? undefined : open)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const prev = last.current
    last.current = open
    if (open === prev) return
    // The panel is in view already (sticky): no scroll for the focus.
    if (open) document.querySelector<HTMLElement>('[data-trip-panel]')?.focus({ preventScroll: true })
    else if (prev)
      [...document.querySelectorAll<HTMLAnchorElement>('.board-grid a[href*="/trip/"]')]
        .find((a) => isTripHref(a.getAttribute('href') ?? '', prev))
        ?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open], [role="dialog"][data-state="open"]')) return
      e.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
}

type Go = (to: string, opts?: { replace?: boolean; state?: unknown; preventScrollReset?: boolean }) => void

/**
 * The panel's ✕ and "Open full page" for the board's router: `go` navigates, `back` goes back in history, `board` is
 * the board's URL and `here` the trip's (path and search). `report` takes the trip's answer (a state setter: stable).
 */
export function panelControls(
  go: Go,
  back: () => void,
  board: string,
  here: string,
  report?: Panel['report'],
): Panel {
  return {
    report,
    close: () => (fromBoardRow() ? back() : go(board, { preventScrollReset: true })),
    openFull: () =>
      go(fullHref(here), {
        replace: true,
        state: (globalThis.history?.state as { usr?: unknown } | null)?.usr,
      }),
    fullHref: fullHref(here),
  }
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

/** The layout tells which board it shows (its loader's place, as `placeOf` would write it). Client only. */
export function showBoard(segment: string, place: Omit<Place, 'trip'>) {
  if (typeof document !== 'undefined') shown.set(segment, { ...place, trip: false })
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

/** A trip route's `shouldRevalidate`: not between its panel and its full page (the same trip, only `?full=` differs). */
export function onlyFullChanged(currentUrl: URL, nextUrl: URL): boolean {
  if (currentUrl.pathname !== nextUrl.pathname) return false
  const strip = (u: URL) => {
    const q = new URLSearchParams(u.search)
    q.delete(FULL)
    q.sort()
    return q.toString()
  }
  return strip(currentUrl) === strip(nextUrl)
}
