// @vitest-environment jsdom
/** THE-118 PR 1: the train board's star, and its Undo with a full favourites list. */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStar } from '../app/components/StationBoard.tsx'
import { FAVOURITES_KEY, MAX_FAVOURITES, readFavourites } from '../app/lib/storage.ts'

const KEYS = [
  'central',
  'roma-street',
  'fortitude-valley',
  'bowen-hills',
  'south-brisbane',
  'milton',
  'auchenflower',
  'toowong',
]

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('train board star', () => {
  it('Undo after saving into a full list brings back the favourite it let go, at its place (Codex r2)', () => {
    const full = KEYS.slice(0, MAX_FAVOURITES).map((from) => ({ from, to: null }))
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(full))
    const { result } = renderHook(() =>
      useStar({ from: 'indooroopilly', to: null }, 'Indooroopilly', () => {}),
    )
    act(() => result.current.toggle())
    expect(readFavourites()[0]).toEqual({ from: 'indooroopilly', to: null })
    expect(readFavourites()).not.toContainEqual(full[MAX_FAVOURITES - 1])
    render(result.current.toast)
    act(() => screen.getByRole('button', { name: 'Undo' }).click())
    expect(readFavourites()).toEqual(full)
    expect(result.current.saved).toBe(false)
  })

  it('saves the station alone, and offers "Pick a destination"', () => {
    let picked = 0
    const { result } = renderHook(() => useStar({ from: 'central', to: null }, 'Central', () => picked++))
    act(() => result.current.toggle())
    expect(readFavourites()).toEqual([{ from: 'central', to: null }])
    render(result.current.toast)
    act(() => screen.getByRole('button', { name: 'Pick a destination' }).click())
    expect(picked).toBe(1)
  })
})
