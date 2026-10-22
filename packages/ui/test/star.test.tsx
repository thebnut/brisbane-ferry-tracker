// @vitest-environment jsdom
/** THE-118 PR 1: the one star (labelled and icon-only) and the save toast. */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveToast } from '../src/SaveToast.tsx'
import { StarButton } from '../src/star.tsx'

afterEach(() => vi.useRealTimers())

describe('StarButton', () => {
  it('labelled: "Save" / "Saved" in its name, the place and My Transit, and aria-pressed', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<StarButton saved={false} onToggle={onToggle} name="Central" />)
    const off = screen.getByRole('button', { name: 'Save Central to My Transit' })
    expect(off.getAttribute('aria-pressed')).toBe('false')
    expect(off.textContent).toContain('Save')
    fireEvent.click(off)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<StarButton saved onToggle={onToggle} name="Central" />)
    const on = screen.getByRole('button', { name: 'Saved Central to My Transit' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
  })

  it('icon-only: the same name without visible words, 44 px', () => {
    render(<StarButton variant="icon" saved onToggle={() => {}} name="Central" />)
    const b = screen.getByRole('button', { name: 'Save Central to My Transit', pressed: true })
    expect(b.className).toContain('size-11')
    expect(b.textContent).toBe('')
  })
})

describe('SaveToast', () => {
  it('says what was saved, offers Undo, and goes after a few seconds', () => {
    vi.useFakeTimers()
    const onUndo = vi.fn()
    const onGone = vi.fn()
    const { rerender } = render(<SaveToast toast={null} onUndo={onUndo} onGone={onGone} />)
    const status = screen.getByRole('status')
    rerender(<SaveToast toast={{ name: 'Central' }} onUndo={onUndo} onGone={onGone} />)
    expect(status.textContent).toContain('Central saved to My Transit')
    expect(screen.queryByRole('button', { name: 'Pick a destination' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(7000))
    expect(onGone).toHaveBeenCalled()
  })

  it('with no destination: "Pick a destination" opens the picker and closes the toast', () => {
    const pick = vi.fn()
    const onGone = vi.fn()
    render(<SaveToast toast={{ name: 'Central', pickDestination: pick }} onUndo={() => {}} onGone={onGone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a destination' }))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it("says so when the device didn't keep it", () => {
    render(<SaveToast toast={{ name: 'Central', kept: false }} onUndo={() => {}} onGone={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain("isn't keeping changes")
  })
})
