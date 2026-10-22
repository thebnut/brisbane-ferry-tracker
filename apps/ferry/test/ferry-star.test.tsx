// @vitest-environment jsdom
/** THE-118 PR 1: the ferry board's star follows the stored list, and Undo takes out the trip its toast is about. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import FerryStar from '../app/components/FerryStar.tsx'
import { addFerryFavourite, FAVOURITES_KEY } from '../app/lib/favourites.ts'
import { BULIMBA, RIVERSIDE } from '../app/lib/terminals.ts'

const stored = () => JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')
const button = () => screen.getByRole('button', { name: /to My Transit$/ })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(cleanup)

describe('FerryStar', () => {
  it('Undo removes the trip that was saved, even after the board moved to another saved trip', () => {
    addFerryFavourite({ from: RIVERSIDE, to: BULIMBA })
    const { rerender } = render(<FerryStar from={BULIMBA} to={RIVERSIDE} />)
    fireEvent.click(button())
    expect(button().getAttribute('aria-pressed')).toBe('true')
    rerender(<FerryStar from={RIVERSIDE} to={BULIMBA} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(stored()).toEqual([{ from: RIVERSIDE, to: BULIMBA }])
    expect(button().getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a trip saved elsewhere on the page (the stop selector) as saved, so a tap never unsaves by surprise', () => {
    render(<FerryStar from={BULIMBA} to={RIVERSIDE} />)
    expect(button().getAttribute('aria-pressed')).toBe('false')
    act(() => {
      addFerryFavourite({ from: BULIMBA, to: RIVERSIDE })
    })
    expect(button().getAttribute('aria-pressed')).toBe('true')
  })
})
