/** THE-118 PR 4: the shared departure row and its rules (status line, soonest row, Tomorrow divider, tile text). */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  BigCountdown,
  DepartureRow,
  dayDividers,
  hoursAway,
  nextAlike,
  soonestIndex,
  statusLine,
} from '../src/row.tsx'
import { contrastRatio, PlatformLineTile, textOn } from '../src/train.tsx'

const NOW = Date.UTC(2026, 9, 22, 9, 38) // 7:38 pm Thu 22 Oct, Brisbane
const at = (h: number, m: number) => Date.UTC(2026, 9, 22, h - 10, m) / 1000

describe('statusLine', () => {
  it('live on time, late and early, from the clocks shown', () => {
    expect(statusLine({ status: 'live', schedDep: at(19, 42), estDep: at(19, 42) })).toEqual({
      dot: 'live',
      text: 'Live · on time',
      tone: 'good',
      claim: true,
    })
    // 7:42:50 → 7:43:10 is "1 min late": the clocks shown differ by a minute.
    expect(statusLine({ status: 'live', schedDep: at(19, 42) + 50, estDep: at(19, 43) + 10 })).toMatchObject({
      text: 'Live · 1 min late',
      tone: 'late',
    })
    expect(statusLine({ status: 'live', schedDep: at(19, 42), estDep: at(19, 44) })).toMatchObject({
      text: 'Live · 2 min late',
      tone: 'late',
      claim: true,
    })
    expect(statusLine({ status: 'live', schedDep: at(19, 42), estDep: at(19, 40) })).toMatchObject({
      text: 'Live · 2 min early',
      tone: 'early',
    })
    // No live estimate yet: on time.
    expect(statusLine({ status: 'live', schedDep: at(19, 42), estDep: null }).text).toBe('Live · on time')
    // No timetabled time at all (an Ask answer): only "Live", never a guess at on time.
    expect(statusLine({ status: 'live' }).text).toBe('Live')
  })

  it('scheduled and unknown claim nothing live', () => {
    expect(statusLine({ status: 'scheduled', schedDep: at(19, 42), estDep: null })).toEqual({
      dot: 'scheduled',
      text: 'Scheduled',
      tone: 'neutral',
      claim: false,
    })
    expect(statusLine({ status: 'unknown' })).toMatchObject({
      dot: 'scheduled',
      text: 'Status unknown',
      claim: false,
    })
  })

  it('cancelled, with the next one like it when there is one', () => {
    expect(statusLine({ status: 'cancelled', next: { name: '60', minutes: 15 } })).toEqual({
      dot: 'cancelled',
      text: 'Cancelled · next 60 in 15 min',
      tone: 'bad',
      claim: false,
    })
    expect(statusLine({ status: 'cancelled', next: { name: '60', minutes: -1 } }).text).toBe(
      'Cancelled · next 60 in 0 min',
    )
    expect(statusLine({ status: 'cancelled' }).text).toBe('Cancelled')
  })

  it('skipped: not stopping here', () => {
    expect(statusLine({ status: 'skipped' })).toMatchObject({
      dot: 'cancelled',
      text: 'Not stopping here',
      claim: false,
    })
  })

  it('a platform change replaces "on time", and keeps a delay', () => {
    expect(
      statusLine({ status: 'live', schedDep: at(19, 42), estDep: at(19, 42), platformFrom: '5' }).text,
    ).toBe('Live · platform changed from 5')
    expect(
      statusLine({ status: 'live', schedDep: at(19, 42), estDep: at(19, 45), platformFrom: '5' }).text,
    ).toBe('Live · 3 min late · platform changed from 5')
  })
})

describe('soonest row and next alike', () => {
  it('the first row you can board: cancelled and skipped rows are passed over', () => {
    expect(soonestIndex([{ status: 'live' }, { status: 'scheduled' }])).toBe(0)
    expect(soonestIndex([{ status: 'cancelled' }, { status: 'skipped' }, { status: 'scheduled' }])).toBe(2)
    expect(soonestIndex([{ status: 'cancelled' }])).toBe(-1)
    expect(soonestIndex([])).toBe(-1)
  })
  it("a cancelled row's next: the first later boardable row that matches", () => {
    const rows = [
      { status: 'cancelled', r: '60' },
      { status: 'live', r: '61' },
      { status: 'cancelled', r: '60' },
      { status: 'scheduled', r: '60' },
    ]
    expect(nextAlike(rows, 0, (x) => x.r === '60')).toBe(rows[3])
    expect(nextAlike(rows, 3, (x) => x.r === '60')).toBeUndefined()
  })
})

describe('dayDividers', () => {
  it('one divider at the first row of each later day, "Tomorrow" first', () => {
    const rows = [at(23, 40), at(23, 55), at(24 + 5, 10), at(24 + 6, 0), at(48 + 5, 10)]
    expect(dayDividers(rows, NOW)).toEqual([null, null, 'Tomorrow · Fri 23 Oct', null, 'Sat 24 Oct'])
  })
  it('a board that starts tomorrow opens with the divider; today-only boards have none', () => {
    expect(dayDividers([at(29, 10)], NOW)).toEqual(['Tomorrow · Fri 23 Oct'])
    expect(dayDividers([at(19, 50), at(20, 0)], NOW)).toEqual([null, null])
  })
  it('Brisbane midnight, not UTC: 11:59 pm is today, 12:00 am is tomorrow', () => {
    expect(dayDividers([at(23, 59), at(24, 0)], NOW)).toEqual([null, 'Tomorrow · Fri 23 Oct'])
  })
})

describe('countdown', () => {
  it('"in 1 hr 29" past an hour, with the clock time as the big figure', () => {
    expect(hoursAway(89)).toBe('in 1 hr 29')
    expect(hoursAway(240)).toBe('in 4 hr')
    const { container } = render(<BigCountdown minutes={89} time="9:07 pm" />)
    expect(container.textContent).toBe('9:07 pmin 1 hr 29')
  })
  it('"4 min", orange at 5 min or less, charcoal after', () => {
    const { container, rerender } = render(<BigCountdown minutes={5} time="7:43 pm" />)
    expect(screen.getByText('5 min').className).toContain('text-ferry-orange-aa')
    rerender(<BigCountdown minutes={6} time="7:44 pm" />)
    expect(screen.getByText('6 min').className).toContain('text-charcoal')
    rerender(<BigCountdown minutes={0} time="7:38 pm" />)
    expect(container.textContent).toBe('Now7:38 pm')
  })
})

describe('tile text on a line colour', () => {
  it('picks the colour with the better contrast', () => {
    expect(textOn('FFC425')).toBe('2D3436') // Gold Coast, Airport
    expect(textOn('6CC6E9')).toBe('2D3436') // Redcliffe, Springfield
    expect(textOn('D53E45')).toBe('FFFFFF')
    expect(textOn('666D8E')).toBe('FFFFFF')
    expect(contrastRatio('FFFFFF', '000000')).toBeCloseTo(21, 5)
  })
  it('the train tile carries PLAT, the platform and an orange ring for a change', () => {
    const { rerender } = render(<PlatformLineTile platform="6" color="FFC425" />)
    const tile = screen.getByRole('img', { name: 'Platform 6' })
    expect(tile.textContent).toBe('PLAT6')
    expect(tile.style.color).toBe('rgb(45, 52, 54)')
    expect(tile).not.toHaveAttribute('data-platform-change')
    rerender(<PlatformLineTile platform="6" color="D53E45" changedFrom="5" />)
    const changed = screen.getByRole('img', { name: 'Platform 6, changed from 5' })
    expect(changed).toHaveAttribute('data-platform-change', 'true')
    expect(changed.className).toContain('ring-ferry-orange-aa')
  })
})

describe('DepartureRow', () => {
  const live = { status: 'live' as const, ...statusLine({ status: 'live', schedDep: 1, estDep: 1 }) }
  it('tile, destination, dot and word, one fact, countdown; no LIVE/GPS/SCHEDULED pills', async () => {
    const onSelect = vi.fn()
    const { container } = render(
      <DepartureRow
        tile={<span>F11</span>}
        destination="Riverside"
        status={live}
        fact="arr 7:54 pm"
        minutes={4}
        time="7:42 pm"
        highlighted
        onSelect={onSelect}
        label="7:42 pm express to Riverside"
      />,
    )
    const row = screen.getByTestId('departure')
    expect(row).toHaveAttribute('data-highlighted', 'true')
    expect(row).toHaveAttribute('data-status', 'live')
    expect(container.querySelector('[data-row-status]')?.textContent).toBe('Live · on time·arr 7:54 pm')
    expect(container.querySelector('[data-badge]')).toBeNull()
    expect(screen.getByText('4 min')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '7:42 pm express to Riverside' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
  it('the dot and the live words are the live claim the guard hides; the fact is not', () => {
    const { container } = render(
      <DepartureRow tile={null} destination="X" status={live} fact="Beenleigh line" minutes={4} time="t" />,
    )
    const claim = container.querySelector('[data-live-claim]')
    expect(claim?.querySelector('[data-dot="live"]')).not.toBeNull()
    expect(claim?.textContent).toContain('Live · on time')
    expect(claim?.textContent).not.toContain('Beenleigh')
  })
  it('a scheduled row claims nothing', () => {
    const { container } = render(
      <DepartureRow
        tile={null}
        destination="X"
        status={{ status: 'scheduled', ...statusLine({ status: 'scheduled' }) }}
        minutes={4}
        time="t"
      />,
    )
    expect(container.querySelector('[data-live-claim]')).toBeNull()
    expect(container.querySelector('[data-dot="scheduled"]')).not.toBeNull()
  })
  it('the extra column shows only on a wide row, where the wide fact replaces the phone one', () => {
    const { container } = render(
      <DepartureRow
        tile={null}
        destination="X"
        status={live}
        fact="arr 7:54 pm"
        wideFact="Beenleigh line"
        extra="Arrives 7:54 pm"
        minutes={4}
        time="t"
      />,
    )
    expect(container.querySelector('[data-extra]')?.className).toMatch(/\bhidden\b.*@lg:flex/)
    expect(screen.getByText('arr 7:54 pm').className).toContain('@lg:hidden')
    expect(screen.getByText('Beenleigh line').className).toMatch(/\bhidden\b.*@lg:inline/)
  })
  it('a cancelled row strikes the destination and has no countdown', () => {
    render(
      <DepartureRow
        tile={null}
        destination="Teneriffe"
        status={{
          status: 'cancelled',
          ...statusLine({ status: 'cancelled', next: { name: '60', minutes: 15 } }),
        }}
        minutes={null}
        time="8:01 pm"
        href="/trip/x"
        renderLink={({ href, className, children, label }) => (
          <a href={href} className={className} aria-label={label}>
            {children}
          </a>
        )}
        label="cancelled"
      />,
    )
    expect(screen.getByTestId('destination').className).toContain('line-through')
    expect(screen.getByText('Cancelled · next 60 in 15 min')).toBeInTheDocument()
    expect(screen.queryByText(/min$/, { selector: '[data-countdown] span' })).toBeNull()
    expect(screen.getByRole('link', { name: 'cancelled' })).toHaveAttribute('href', '/trip/x')
  })
})

describe('DepartureRow separators', () => {
  const live = { status: 'live' as const, ...statusLine({ status: 'live', schedDep: 1, estDep: 1 }) }
  const dot = (fact: string | null, wideFact: string | null, extra: string | null) => {
    const { container, unmount } = render(
      <DepartureRow
        tile={null}
        destination="X"
        status={live}
        fact={fact}
        wideFact={wideFact}
        extra={extra}
        minutes={4}
        time="t"
      />,
    )
    const sep = [...container.querySelectorAll('[data-live-claim] span[aria-hidden]')].find(
      (s) => s.textContent === '·',
    )
    const cls = sep ? sep.className : null
    unmount()
    return cls
  }
  it('the "·" before the fact shows only at the widths where a fact does', () => {
    expect(dot('arr 7:54 pm', null, 'Arrives 7:54 pm')).toBe('@lg:hidden')
    expect(dot(null, 'express', 'Arrives 7:54 pm')).toBe('hidden @lg:inline')
    expect(dot('arr 7:54 pm', 'Beenleigh line', 'Arrives 7:54 pm')).toBe('')
    expect(dot('GPS', 'GPS', null)).toBe('')
    // No extra column: only the phone fact shows, so a wide fact alone never leaves a dangling dot (Codex r2).
    expect(dot(null, 'express', null)).toBeNull()
    expect(dot(null, null, null)).toBeNull()
  })
})

describe("rows you can't board (Codex r1)", () => {
  it.each(['cancelled', 'skipped'] as const)('a %s row never counts down, even when given minutes', (st) => {
    const { container } = render(
      <DepartureRow
        tile={null}
        destination="X"
        status={{ status: st, ...statusLine({ status: st }) }}
        minutes={4}
        time="7:42 pm"
      />,
    )
    expect(container.querySelector('[data-countdown]')).toHaveAttribute('data-countdown', 'cancelled')
    expect(container.textContent).not.toContain('4 min')
  })
})
