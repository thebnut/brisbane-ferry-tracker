/** Desktop master–detail (THE-118 PR 7): when a board's loader runs again, the panel's URLs and its chrome. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fullHref, isTripHref, onlyFullChanged, panelControls, samePlace } from '../src/panel.tsx'
import { BOARD_STATE } from '../src/row.tsx'
import { TripPanelFrame } from '../src/trip.tsx'

const U = (path: string) => new URL(path, 'https://x.test')

const same = (a: string, b: string, segment = 'terminal', formMethod?: string) =>
  samePlace({ currentUrl: U(a), nextUrl: U(b), formMethod }, segment)

describe('samePlace', () => {
  it('a trip opening and closing beside its board is the same place', () => {
    expect(same('/terminal/bulimba?to=riverside', '/trip/t1@20261023?from=bulimba&to=riverside')).toBe(true)
    expect(same('/trip/t1@20261023?from=bulimba&to=riverside', '/terminal/bulimba?to=riverside')).toBe(true)
    expect(same('/terminal/bulimba', '/trip/t1@20261023?from=bulimba')).toBe(true)
    // Another row while a trip is open, and the full page.
    expect(same('/trip/t1@20261023?from=bulimba', '/trip/t2@20261023?from=bulimba')).toBe(true)
    expect(same('/trip/t1@20261023?from=bulimba', '/trip/t1@20261023?from=bulimba&full=1')).toBe(true)
  })

  it("a return-board row's trip (the other way) is the same board", () => {
    expect(same('/terminal/bulimba?to=riverside', '/trip/t9@20261023?from=riverside&to=bulimba')).toBe(true)
    expect(
      same('/trip/t9@20261023?from=riverside&to=bulimba', '/trip/t1@20261023?from=bulimba&to=riverside'),
    ).toBe(true)
  })

  it('another place, destination, direction or demo mode runs the loader again', () => {
    expect(same('/terminal/bulimba', '/terminal/hawthorne')).toBe(false)
    expect(same('/terminal/bulimba', '/terminal/bulimba?to=riverside')).toBe(false)
    // ⇄ swaps the board itself.
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

  it("a bus trip keeps its board's route filter; the filter itself changes the board", () => {
    expect(same('/stop/10802?route=61', '/trip/t1@20261023?from=10802', 'stop')).toBe(true)
    expect(same('/trip/t1@20261023?from=10802', '/stop/10802?route=61', 'stop')).toBe(true)
    expect(same('/stop/10802?route=61', '/stop/10802', 'stop')).toBe(false)
    expect(same('/stop/10802', '/trip/t1@20261023?from=10803', 'stop')).toBe(false)
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
