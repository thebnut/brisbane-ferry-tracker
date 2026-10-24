// @vitest-environment jsdom
/** THE-118 PR 8: the mode homes' page state (useLiveReports) and their sections. */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  AboutTimes,
  homeCard,
  LiveReports,
  NearPlaceRow,
  SavedEmpty,
  UseLocationRow,
  useLiveReports,
  useReportLive,
} from '../src/mode-home.tsx'

/** `liveRows` (a departure the row shows is live) defaults to `live`. */
type Value = [live: boolean, pending?: boolean, failed?: boolean, liveRows?: boolean]

/** A page whose rows report `rows`, showing its live answer. */
function Page({ initial, rows }: { initial: { live?: boolean; pending?: boolean }; rows: Value[] }) {
  const r = useLiveReports(initial)
  return (
    <LiveReports value={r.report}>
      <output data-testid="state">{`${r.live}/${r.pending}`}</output>
      {rows.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows.
        <Row key={i} id={`r${i}`} v={v} />
      ))}
    </LiveReports>
  )
}
function Row({ id, v }: { id: string; v: Value }) {
  const [live, pending = false, failed = false, liveRows = live] = v
  useReportLive(id, live, pending, failed, liveRows)
  return null
}
const state = () => screen.getByTestId('state').textContent

describe('useLiveReports', () => {
  it("no live rows: the loader's answer; none at all claims nothing (#159)", () => {
    render(<Page initial={{}} rows={[]} />)
    expect(state()).toBe('undefined/false')
  })

  it('LIVE only while every row is live', () => {
    const { rerender } = render(<Page initial={{ live: false, pending: true }} rows={[[true], [true]]} />)
    expect(state()).toBe('true/false')
    rerender(<Page initial={{ live: false, pending: true }} rows={[[true], [false]]} />)
    expect(state()).toBe('false/false')
  })

  it('"Connecting…" while a row waits and the others are live; a failure wins (R32-RT1)', () => {
    const { rerender } = render(<Page initial={{}} rows={[[false, true], [true]]} />)
    expect(state()).toBe('false/true')
    rerender(
      <Page
        initial={{}}
        rows={[
          [false, true],
          [false, false, true],
        ]}
      />,
    )
    expect(state()).toBe('false/false')
    // Live data still shown after a failed request: live for the pill, never pending.
    rerender(
      <Page
        initial={{}}
        rows={[
          [false, true],
          [true, false, true],
        ]}
      />,
    )
    expect(state()).toBe('false/false')
    rerender(<Page initial={{}} rows={[[true, false, true]]} />)
    expect(state()).toBe('true/false')
  })

  it('LIVE only over a live row shown: live data that is all timetabled claims nothing (R36-L1)', () => {
    // The Bulimba → Riverside card at 6:17am: the feed is live, the next ferries are timetabled.
    const { rerender } = render(<Page initial={{ live: true }} rows={[[true, false, false, false]]} />)
    expect(state()).toBe('undefined/false')
    // One card with a live row: LIVE, whatever the others' timetabled rows.
    rerender(
      <Page
        initial={{ live: true }}
        rows={[
          [true, false, false, false],
          [true, false, false, true],
        ]}
      />,
    )
    expect(state()).toBe('true/false')
    // A stale one still says OFFLINE; one still waiting still says "Connecting…".
    rerender(
      <Page
        initial={{}}
        rows={[
          [true, false, false, false],
          [false, false, false, false],
        ]}
      />,
    )
    expect(state()).toBe('false/false')
    rerender(
      <Page
        initial={{}}
        rows={[
          [true, false, false, false],
          [false, true],
        ]}
      />,
    )
    expect(state()).toBe('false/true')
    // A failed request over timetabled rows is a failure: OFFLINE, never hidden by a waiting row.
    rerender(
      <Page
        initial={{}}
        rows={[
          [true, false, true, false],
          [false, true],
        ]}
      />,
    )
    expect(state()).toBe('false/false')
  })

  it('a row that goes away stops counting', () => {
    function Toggle() {
      const [on, setOn] = useState(true)
      const r = useLiveReports({})
      return (
        <LiveReports value={r.report}>
          <output data-testid="state">{`${r.live}/${r.pending}`}</output>
          <Row id="a" v={[true]} />
          {on ? <Row id="b" v={[false]} /> : null}
          <button type="button" onClick={() => setOn(false)}>
            off
          </button>
        </LiveReports>
      )
    }
    render(<Toggle />)
    expect(state()).toBe('false/false')
    act(() => fireEvent.click(screen.getByText('off')))
    expect(state()).toBe('true/false')
  })
})

describe('sections', () => {
  it('Saved, empty: one line with the star', () => {
    render(<SavedEmpty />)
    expect(screen.getByText('Tap ☆ on any board to save it.')).toBeTruthy()
  })

  it('About: closed, its copy in the markup', () => {
    const { container } = render(
      <AboutTimes title="About ferry times">
        <p>Live departure boards</p>
      </AboutTimes>,
    )
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Live departure boards')
    expect(screen.getByText('About ferry times').closest('summary')).toBeTruthy()
  })

  it('Use my location: asks only when tapped, and says when location is off', () => {
    const locate = vi.fn()
    const { rerender } = render(<UseLocationRow state="idle" onLocate={locate} what="stops" />)
    expect(locate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(locate).toHaveBeenCalledOnce()
    rerender(<UseLocationRow state="denied" onLocate={locate} what="stops" />)
    expect(screen.getByText(/Location is off/)).toBeTruthy()
    rerender(<UseLocationRow state="locating" onLocate={locate} what="stops" />)
    expect((screen.getByRole('button', { name: 'Locating…' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('NearPlaceRow (Codex release review r2)', () => {
  const row = (props: Partial<Parameters<typeof NearPlaceRow>[0]>) => (
    <ul>
      <NearPlaceRow mode="ferry" name="Bulimba" metres={200} href="/b" next={null} {...props} />
    </ul>
  )

  it('failed: "Departures unavailable" with the walk, a link to the board and Try again beside it', () => {
    const retry = vi.fn()
    render(row({ failed: true, onRetry: retry }))
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/b')
    expect(link.textContent).toContain('Departures unavailable · 200 m · 3 min walk')
    expect(screen.queryByText(/No more departures today/)).toBeNull()
    const button = screen.getByRole('button', { name: 'Try again: Bulimba' })
    expect(link.contains(button)).toBe(false)
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('failed while it asks again: still unavailable, never "Getting departures…"', () => {
    render(row({ failed: true, loading: true, onRetry: () => {} }))
    expect(screen.getByText(/Departures unavailable/)).toBeTruthy()
    expect(screen.queryByText(/Getting departures/)).toBeNull()
  })

  it('a departure to show wins over a failure: the departure, no Try again', () => {
    render(row({ failed: true, onRetry: () => {}, next: { route: 'F1', to: 'Riverside', minutes: 12 } }))
    expect(screen.getByText('Riverside')).toBeTruthy()
    expect(screen.queryByText(/Departures unavailable/)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('loading, then a successful empty answer: "Getting departures…", then "No more departures today"', () => {
    const { rerender } = render(row({ loading: true }))
    expect(screen.getByText(/Getting departures…/)).toBeTruthy()
    rerender(row({}))
    expect(screen.getByText(/No more departures today/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('homeCard', () => {
  const NOW = Date.UTC(2026, 9, 19, 9, 30)
  const s = NOW / 1000
  const d = (schedDep: number, estDep: number | null = null, status = 'scheduled', tripInstance = 't@1') => ({
    tripInstance,
    status,
    schedDep,
    estDep,
    schedArrTo: null,
    estArrTo: null,
    route: { short: '66' },
    headsign: 'UQ Lakes',
    platform: null,
    vehicleId: null,
  })

  it('the next departure is the soonest by the time shown, whatever order the rows came in (Codex r1)', () => {
    // A board that dropped its live estimates keeps the live order: 10 min (was due in 1) before 2 min.
    const card = homeCard(
      'bus',
      { rtState: 'stale', stop: { name: 'Stop' }, to: null, departures: [d(s + 600), d(s + 120)] },
      NOW,
      'Stop',
      '1',
    )
    expect(card.minutes).toBe(2)
    expect(card.next).toBe(s + 120)
  })

  it('an extra service says so; an arrival is never before the departure shown (Codex r3)', () => {
    const extra = { ...d(s + 120, s + 300, 'live', 'rt:abc'), schedArrTo: s + 280, estArrTo: null }
    const card = homeCard(
      'bus',
      { rtState: 'live', stop: { name: 'Stop' }, to: null, departures: [extra] },
      NOW,
      'Stop',
      '1',
    )
    expect(card.detail).toBe('Extra service · Stop 1')
    expect(card.time).toBe('7:35 pm → 7:35 pm')
  })

  it('liveRows: a live departure among the three shown, from a live feed only (R36-L1)', () => {
    const res = (rtState: string, ...departures: ReturnType<typeof d>[]) => ({
      rtState,
      stop: { name: 'Stop' },
      to: null,
      departures,
    })
    const card = (r: ReturnType<typeof res>) => homeCard('bus', r, NOW, 'Stop', '1')
    expect(card(res('live', d(s + 120), d(s + 600))).liveRows).toBe(false)
    expect(card(res('live', d(s + 120), d(s + 600, s + 660, 'live'))).liveRows).toBe(true)
    // Not shown: the fourth departure, a cancelled one.
    expect(card(res('live', d(s + 60), d(s + 120), d(s + 180), d(s + 240, s + 240, 'live'))).liveRows).toBe(
      false,
    )
    expect(card(res('live', d(s + 60, s + 60, 'cancelled'), d(s + 120))).liveRows).toBe(false)
    expect(card(res('stale', d(s + 120, s + 180, 'live'))).liveRows).toBe(false)
  })
})
