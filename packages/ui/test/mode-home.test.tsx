// @vitest-environment jsdom
/** THE-118 PR 8: the mode homes' page state (useLiveReports) and their sections. */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  AboutTimes,
  homeCard,
  LiveReports,
  SavedEmpty,
  UseLocationRow,
  useLiveReports,
  useReportLive,
} from '../src/mode-home.tsx'

type Value = [live: boolean, pending?: boolean, failed?: boolean]

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
  useReportLive(id, ...v)
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

describe('homeCard', () => {
  const NOW = Date.UTC(2026, 9, 19, 9, 30)
  const s = NOW / 1000
  const d = (schedDep: number, estDep: number | null = null, status = 'scheduled') => ({
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
})
