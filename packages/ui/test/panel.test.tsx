/** Desktop master–detail (THE-118 PR 7): when a board's loader runs again, the panel's URLs and its chrome. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PanelState, samePlace, showBoard } from '../src/board-route.ts'
import { type LiveState, pagePending } from '../src/connectivity.ts'
import { fullHref, isTripHref, onlyFullChanged, panelControls } from '../src/panel.tsx'

/** A board's header with the trip beside it, as the bus layout and FerryBoards combine them. */
const withPanel = (
  live: boolean,
  pending: boolean,
  board: PanelState['q'],
  state: LiveState,
  panel: PanelState | null,
) =>
  panel ? { live: live && panel.live, pending: pagePending([{ q: board, state }, panel]) } : { live, pending }

import { BOARD_STATE } from '../src/row.tsx'
import { TripPanelFrame } from '../src/trip.tsx'

const U = (path: string) => new URL(path, 'https://x.test')

const same = (a: string, b: string, segment = 'terminal', formMethod?: string) =>
  samePlace({ currentUrl: U(a), nextUrl: U(b), formMethod }, segment)

describe('samePlace', () => {
  const bulimba = () => showBoard('terminal', { from: 'bulimba', to: 'riverside', filter: null })

  it('a trip opening and closing beside its board is the same board', () => {
    bulimba()
    expect(same('/terminal/bulimba?to=riverside', '/trip/t1@20261023?from=bulimba&to=riverside')).toBe(true)
    expect(same('/trip/t1@20261023?from=bulimba&to=riverside', '/terminal/bulimba?to=riverside')).toBe(true)
    // Another row while a trip is open, and the full page.
    expect(
      same('/trip/t1@20261023?from=bulimba&to=riverside', '/trip/t2@20261023?from=bulimba&to=riverside'),
    ).toBe(true)
    expect(
      same(
        '/trip/t1@20261023?from=bulimba&to=riverside',
        '/trip/t1@20261023?from=bulimba&to=riverside&full=1',
      ),
    ).toBe(true)
    showBoard('terminal', { from: 'bulimba', to: null, filter: null })
    expect(same('/terminal/bulimba', '/trip/t1@20261023?from=bulimba')).toBe(true)
  })

  it("a return-board row's trip (the other way) belongs to the board shown", () => {
    bulimba()
    expect(same('/terminal/bulimba?to=riverside', '/trip/t9@20261023?from=riverside&to=bulimba')).toBe(true)
    expect(
      same('/trip/t9@20261023?from=riverside&to=bulimba', '/trip/t1@20261023?from=bulimba&to=riverside'),
    ).toBe(true)
    expect(same('/trip/t9@20261023?from=riverside&to=bulimba', '/terminal/bulimba?to=riverside')).toBe(true)
  })

  it('⇄, another destination or place from beside a trip is a new board', () => {
    bulimba()
    expect(same('/trip/t1@20261023?from=bulimba&to=riverside', '/terminal/riverside?to=bulimba')).toBe(false)
    expect(same('/trip/t9@20261023?from=riverside&to=bulimba', '/terminal/riverside?to=bulimba')).toBe(false)
    expect(same('/trip/t1@20261023?from=bulimba&to=riverside', '/terminal/bulimba')).toBe(false)
    expect(same('/trip/t1@20261023?from=bulimba&to=riverside', '/trip/t5@20261023?from=hawthorne')).toBe(
      false,
    )
  })

  it('another place, destination, direction or demo mode runs the loader again', () => {
    expect(same('/terminal/bulimba', '/terminal/hawthorne')).toBe(false)
    expect(same('/terminal/bulimba', '/terminal/bulimba?to=riverside')).toBe(false)
    expect(same('/terminal/bulimba?to=riverside', '/terminal/riverside?to=bulimba')).toBe(false)
    expect(same('/terminal/bulimba', '/trip/t1@20261023?from=hawthorne')).toBe(false)
    expect(same('/terminal/bulimba?to=riverside', '/trip/t1@20261023?from=bulimba')).toBe(false)
    expect(same('/terminal/bulimba', '/trip/t1@20261023?from=bulimba&fixtures=1')).toBe(false)
    expect(same('/terminal/bulimba', '/trip/t1@20261023')).toBe(false)
  })

  it('an explicit revalidation or a form action keeps the default', () => {
    expect(same('/terminal/bulimba', '/terminal/bulimba')).toBe(false)
    expect(same('/terminal/bulimba', '/trip/t1@20261023?from=bulimba', 'terminal', 'POST')).toBe(false)
  })

  it("a bus trip keeps its board's route filter; changing the filter is a new board", () => {
    showBoard('stop', { from: '10802', to: null, filter: '61' })
    expect(same('/stop/10802?route=61', '/trip/t1@20261023?from=10802', 'stop')).toBe(true)
    expect(same('/trip/t1@20261023?from=10802', '/stop/10802?route=61', 'stop')).toBe(true)
    expect(same('/trip/t1@20261023?from=10802', '/stop/10802', 'stop')).toBe(false)
    expect(same('/stop/10802?route=61', '/stop/10802', 'stop')).toBe(false)
    expect(same('/stop/10802', '/trip/t1@20261023?from=10803', 'stop')).toBe(false)
  })
})

describe("the trip's answer beside the board (R32-RT1)", () => {
  const q = (o: Partial<PanelState['q']> = {}): PanelState['q'] => ({
    data: true,
    dataUpdatedAt: 1,
    errorUpdateCount: 0,
    failureCount: 0,
    isError: false,
    ...o,
  })
  // A non-live seed whose own request is still out, an own live answer, a failure.
  const waiting = { q: q({ dataUpdatedAt: 0 }), state: 'unavailable' as const, live: false }
  const live = { q: q(), state: null, live: true }
  const failed = { q: q({ isError: true, failureCount: 1 }), state: 'offline' as const, live: false }

  it('a trip still waiting beside a live board: Connecting…, not LIVE', () => {
    expect(withPanel(true, false, q(), null, waiting)).toEqual({ live: false, pending: true })
  })
  it("a board's own non-live answer wins over a trip still waiting", () => {
    expect(withPanel(false, false, q(), 'unavailable', waiting)).toEqual({ live: false, pending: false })
  })
  it("the trip's failure wins over a board still waiting", () => {
    expect(withPanel(false, true, q({ dataUpdatedAt: 0 }), 'unavailable', failed).pending).toBe(false)
  })
  it('both live: LIVE', () => {
    expect(withPanel(true, false, q(), null, live)).toEqual({ live: true, pending: false })
  })
  it('no trip open: the board alone', () => {
    expect(withPanel(true, false, q(), null, null)).toEqual({ live: true, pending: false })
  })
})

describe('a board shown from a trip link', () => {
  it("has only a placeholder: leaving the trip for it runs the board's loader", () => {
    showBoard('station', null)
    expect(same('/trip/t1@20261023?from=central', '/station/central', 'station')).toBe(false)
    showBoard('station', { from: 'central', to: null, filter: null })
    expect(same('/trip/t1@20261023?from=central', '/station/central', 'station')).toBe(true)
  })
})

describe('the panel and its full page', () => {
  it('only ?full= differs: no second trip fetch', () => {
    expect(onlyFullChanged(U('/trip/a@1?from=b&to=c'), U('/trip/a@1?to=c&from=b&full=1'))).toBe(true)
    expect(onlyFullChanged(U('/trip/a@1?from=b&full=1'), U('/trip/a@1?from=b'))).toBe(true)
    expect(onlyFullChanged(U('/trip/a@1?from=b'), U('/trip/a@2?from=b&full=1'))).toBe(false)
    expect(onlyFullChanged(U('/trip/a@1?from=b'), U('/trip/a@1?from=c&full=1'))).toBe(false)
  })

  it('fullHref keeps the query and adds full=1', () => {
    expect(fullHref('/ferry/trip/a%40b?from=bulimba')).toBe('/ferry/trip/a%40b?from=bulimba&full=1')
    expect(fullHref('/bus/trip/x')).toBe('/bus/trip/x?full=1')
  })

  it('isTripHref matches the trip exactly, with or without a query', () => {
    expect(isTripHref('/bus/trip/1%402026?from=1', '1@2026')).toBe(true)
    expect(isTripHref('/bus/trip/1%402026', '1@2026')).toBe(true)
    expect(isTripHref('/bus/trip/1%4020261?from=1', '1@2026')).toBe(false)
  })
})

describe('panelControls', () => {
  afterEach(() => history.replaceState(null, ''))

  it('✕ goes back to the board when a row opened the trip, else opens the board', () => {
    const go = vi.fn()
    const back = vi.fn()
    panelControls(go, back, '/terminal/x', '/trip/a?from=x').close()
    expect(go).toHaveBeenCalledWith('/terminal/x', { preventScrollReset: true })
    history.replaceState({ usr: { [BOARD_STATE]: '/terminal/x' } }, '')
    panelControls(go, back, '/terminal/x', '/trip/a?from=x').close()
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('"Open full page" replaces the panel with ?full=1, keeping the state for its back link', () => {
    const go = vi.fn()
    history.replaceState({ usr: { [BOARD_STATE]: '/terminal/x' } }, '')
    const p = panelControls(go, () => {}, '/terminal/x', '/trip/a?from=x')
    expect(p.fullHref).toBe('/trip/a?from=x&full=1')
    p.openFull()
    expect(go).toHaveBeenCalledWith('/trip/a?from=x&full=1', {
      replace: true,
      state: { [BOARD_STATE]: '/terminal/x' },
    })
  })
})

describe('TripPanelFrame', () => {
  it('is a labelled region with "Open full page" and ✕', async () => {
    const panel = { close: vi.fn(), openFull: vi.fn(), fullHref: '/trip/a?full=1' }
    render(
      <TripPanelFrame panel={panel}>
        <p>Trip</p>
      </TripPanelFrame>,
    )
    const region = screen.getByRole('region', { name: 'Trip details' })
    expect(region).toHaveAttribute('tabindex', '-1')
    const full = screen.getByRole('link', { name: 'Open full page' })
    expect(full).toHaveAttribute('href', '/trip/a?full=1')
    await userEvent.click(full)
    expect(panel.openFull).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close trip details' }))
    expect(panel.close).toHaveBeenCalledTimes(1)
  })
})
