/**
 * The trip panel beside a board (THE-118 PR 7, see board-route.ts): what the board's layout gives the trip page (its
 * context: ✕, "Open full page", the report of its own answer), the panel's focus and Esc. Loaded with the trip, never on
 * a board's first load. The panel's chrome is TripPanelFrame in `@bft/ui/trip`.
 */
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import { FULL, type PanelState } from './board-route.ts'
import type { LiveState, SeededQuery } from './connectivity.ts'
import { BOARD_STATE } from './row.tsx'

export type { PanelState }

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

/**
 * Beside a board, the trip's own answer counts in the page header like any board's. Nothing as its own full page (its
 * header is its own), nor for a trip that has gone (it claims nothing). Reported from its query's primitives, so the
 * layout's state changes only when the answer does.
 */
export function usePanelReport(
  panel: Panel | null,
  q: SeededQuery & { isError: boolean },
  state: LiveState,
  gone: boolean,
) {
  const report = panel?.report
  const has = q.data != null
  const { isError, failureCount, dataUpdatedAt, errorUpdateCount } = q
  useEffect(() => {
    if (!report || gone) return
    report({
      q: { data: has ? true : null, isError, failureCount, dataUpdatedAt, errorUpdateCount },
      state,
      live: has && state == null,
    })
    return () => report(null)
  }, [report, gone, has, isError, failureCount, dataUpdatedAt, errorUpdateCount, state])
}

const PanelContext = createContext<Panel | null>(null)
export const PanelProvider = PanelContext.Provider
/** Null: the trip is its own full page. */
export const usePanel = () => useContext(PanelContext)

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
 * The panel's focus: into the panel when a row opens a trip (Enter on a row; on mount only when a row's link opened it,
 * not for a trip opened from a link), back to that trip's row when the panel closes (Esc, ✕ or browser back), in the
 * board column or the return board beside it. Esc closes the panel unless a sheet or dialog is open over it.
 */
function usePanelFocus(trip: string, close: () => void) {
  const first = useRef(true)
  const open = useRef(trip)
  open.current = trip
  const closeRef = useRef(close)
  closeRef.current = close
  // biome-ignore lint/correctness/useExhaustiveDependencies: again for each trip the panel shows (another row picked).
  useEffect(() => {
    const mount = first.current
    first.current = false
    // The panel is in view already (sticky): no scroll for the focus.
    if (!mount || fromBoardRow())
      document.querySelector<HTMLElement>('[data-trip-panel]')?.focus({ preventScroll: true })
  }, [trip])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open], [role="dialog"][data-state="open"]')) return
      e.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // Closed: once the board has its idle panel back, the focus goes to the row of the trip that was open.
      const last = open.current
      setTimeout(() =>
        [...document.querySelectorAll<HTMLAnchorElement>('.board-grid a[href*="/trip/"]')]
          .find((a) => isTripHref(a.getAttribute('href') ?? '', last))
          ?.focus(),
      )
    }
  }, [])
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

/**
 * The trip as the board's panel, loaded with the trip (each board's layout imports it lazily): the trip page's context
 * (✕, "Open full page", its report to the header), focus into the panel when a row opens it and back to that row when
 * it closes, and Esc. `board` is the board's URL, `here` the trip's; `go` and `back` are the router's.
 */
export default function TripPanelHost({
  trip,
  board,
  here,
  go,
  back,
  report,
  children,
}: {
  trip: string
  board: string
  here: string
  go: Go
  back: () => void
  /** The trip's own answer for the header (train reports through its Shell instead). */
  report?: Panel['report']
  children: ReactNode
}) {
  const panel = panelControls(go, back, board, here, report)
  usePanelFocus(trip, panel.close)
  return <PanelContext.Provider value={panel}>{children}</PanelContext.Provider>
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
