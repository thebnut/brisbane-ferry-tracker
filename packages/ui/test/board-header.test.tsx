/** THE-118 PR 5: the shared board header, its filter row's chips, "Now ▾" and the destination sheet. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BoardHeader, Chip, chipClass, FilterRow, leavingFrom, NowChip } from '../src/board-header.tsx'
import { DestinationChoices, DestinationSheet } from '../src/DestinationSheet.tsx'

const NOW = Date.UTC(2026, 9, 22, 9, 38) // 7:38 pm Thu 22 Oct, Brisbane

describe('BoardHeader', () => {
  it('kicker, the name as a heading, facts in order without empty ones, the star, then the chips', () => {
    render(
      <BoardHeader
        kicker="Train station"
        as="h2"
        name="Central"
        facts={['Platforms 1–6', null, false, '', '9 lines']}
        star={<button type="button">Save</button>}
      >
        <FilterRow label="Filter trains">
          <Chip onClick={() => {}}>All</Chip>
        </FilterRow>
      </BoardHeader>,
    )
    expect(screen.getByText('Train station')).toHaveAttribute('data-kicker')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Central')
    const facts = document.querySelectorAll('[data-board-facts] > [data-fact]')
    expect([...facts].map((f) => f.textContent)).toEqual(['Platforms 1–6', '9 lines'])
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Filter trains' })).toContainElement(
      screen.getByRole('button', { name: 'All' }),
    )
  })
  it('no facts line when there are none', () => {
    render(<BoardHeader kicker="Bus stop" name="Stop 1" facts={[null]} />)
    expect(document.querySelector('[data-board-facts]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stop 1')
  })
})

describe('Chip', () => {
  it('a toggle says so (aria-pressed); a sheet opener says it opens a dialog', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Chip pressed onClick={onClick}>
          Express
        </Chip>
        <Chip opens on onClick={onClick}>
          To Riverside
        </Chip>
        <Chip icon="swap" label="Swap direction" onClick={onClick} />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Express' })).toHaveAttribute('aria-pressed', 'true')
    const to = screen.getByRole('button', { name: 'To Riverside' })
    expect(to).toHaveAttribute('aria-haspopup', 'dialog')
    expect(to).not.toHaveAttribute('aria-pressed')
    // Shown on, as a set destination, without claiming to be a toggle.
    expect(to.className).toContain('bg-ferry-orange-aa')
    await userEvent.click(screen.getByRole('button', { name: 'Swap direction' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('44 px targets; an icon-only chip is 44 px square, not squeezed by padding', () => {
    expect(chipClass()).toContain('h-11')
    expect(chipClass(false, true)).toContain('w-11')
    expect(chipClass(false, true)).not.toContain('px-4')
  })
})

describe('NowChip', () => {
  it('"Now" until a time is picked, then "From 9PM"; a time tomorrow says so', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<NowChip value={null} onChange={onChange} nowMs={NOW} />)
    const select = screen.getByRole('combobox', { name: 'Depart from' })
    expect(document.querySelector('[data-chip=now] > span')).toHaveTextContent('Now')
    // 7:38 pm: 9 PM, 11 PM, then tomorrow from 5 AM (generateTimeSlots).
    const nine = within(select).getByRole('option', { name: '9PM' }) as HTMLOptionElement
    await userEvent.selectOptions(select, nine)
    expect(onChange).toHaveBeenCalledWith(Number(nine.value))
    rerender(<NowChip value={Number(nine.value)} onChange={onChange} nowMs={NOW} />)
    expect(document.querySelector('[data-chip=now] > span')).toHaveTextContent('From 9PM')
    const five = within(select).getByRole('option', { name: '5AM' }) as HTMLOptionElement
    rerender(<NowChip value={Number(five.value)} onChange={onChange} nowMs={NOW} />)
    expect(document.querySelector('[data-chip=now] > span')).toHaveTextContent('From 5AM tomorrow')
    await userEvent.selectOptions(select, 'Now')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('DestinationSheet', () => {
  it('lists the places, the chosen one pressed; "Any destination" only when one is set', async () => {
    const onPick = vi.fn()
    const onAny = vi.fn()
    const options = [
      { id: 'a', name: 'Riverside' },
      { id: 'b', name: 'Teneriffe' },
    ]
    const { rerender } = render(
      <DestinationSheet open onClose={() => {}} title="To, from Bulimba" note="Direct only.">
        <DestinationChoices label="Terminals" options={options} selected={null} onPick={onPick} />
      </DestinationSheet>,
    )
    expect(screen.queryByRole('button', { name: 'Any destination' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Teneriffe' }))
    expect(onPick).toHaveBeenCalledWith('b')
    rerender(
      <DestinationSheet open onClose={() => {}} title="To, from Bulimba" note="Direct only." onAny={onAny}>
        <DestinationChoices label="Terminals" options={options} selected="a" onPick={onPick} />
      </DestinationSheet>,
    )
    expect(screen.getByRole('button', { name: 'Riverside' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Any destination' }))
    expect(onAny).toHaveBeenCalled()
  })
})

describe('leavingFrom', () => {
  const AT = 1_800_000_000
  const rows = [
    { id: 'gone', schedDep: AT - 60, estDep: null },
    { id: 'late', schedDep: AT - 60, estDep: AT + 120 },
    { id: 'on', schedDep: AT, estDep: AT },
  ]
  it('rows leaving at or after the time, by the time shown (a late one counts)', () => {
    expect(leavingFrom(rows, AT).map((r) => r.id)).toEqual(['late', 'on'])
  })
  it('a board that dropped its estimates (offline, stale) shows none timetabled before it (Codex r3)', () => {
    const scheduled = rows.map((r) => ({ ...r, estDep: null }))
    expect(leavingFrom(scheduled, AT).map((r) => r.id)).toEqual(['on'])
  })
  it('now: every row', () => {
    expect(leavingFrom(rows, null)).toBe(rows)
  })
})
