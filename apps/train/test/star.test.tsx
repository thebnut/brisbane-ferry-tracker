// @vitest-environment jsdom
/** THE-118 PR 1: the train board's star, and its Undo with a full favourites list. */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStar } from '../app/components/TrainStar.tsx'
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

  it('Undo never pushes out a favourite saved elsewhere since (Codex r5)', () => {
    const full = KEYS.slice(0, MAX_FAVOURITES).map((from) => ({ from, to: null }))
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(full))
    const { result } = renderHook(() =>
      useStar({ from: 'indooroopilly', to: null }, 'Indooroopilly', () => {}),
    )
    act(() => result.current.toggle())
    // Another tab: Indooroopilly out, Taringa in (full again).
    const elsewhere = [{ from: 'taringa', to: null }, ...full.slice(0, MAX_FAVOURITES - 1)]
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(elsewhere))
    render(result.current.toast)
    act(() => screen.getByRole('button', { name: 'Undo' }).click())
    expect(readFavourites()).toEqual(elsewhere)
  })

  it('follows another tab, and a "Save" tap never unsaves what was saved elsewhere since (Codex r3)', () => {
    const { result } = renderHook(() => useStar({ from: 'central', to: null }, 'Central', () => {}))
    expect(result.current.saved).toBe(false)
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: 'central', to: null }]))
    act(() => {
      dispatchEvent(new StorageEvent('storage', { key: FAVOURITES_KEY }))
    })
    expect(result.current.saved).toBe(true)
    // Before the event arrives: the button still says Save, and tapping it keeps it saved.
    localStorage.setItem(FAVOURITES_KEY, '[]')
    const stale = renderHook(() => useStar({ from: 'central', to: null }, 'Central', () => {}))
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: 'central', to: null }]))
    act(() => stale.result.current.toggle())
    expect(readFavourites()).toEqual([{ from: 'central', to: null }])
    expect(stale.result.current.saved).toBe(true)
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

  it('Undo takes out the favourite its toast is about, after the page has moved to another board (THE-118 PR 5, Codex r1)', () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: 'roma-street', to: null }]))
    const { result, rerender } = renderHook(({ f, name }) => useStar(f, name, () => {}), {
      initialProps: { f: { from: 'central', to: null as string | null }, name: 'Central' },
    })
    act(() => result.current.toggle())
    expect(readFavourites()).toContainEqual({ from: 'central', to: null })
    // The station page moves on to Roma Street (saved before) while the toast is up.
    rerender({ f: { from: 'roma-street', to: null }, name: 'Roma Street' })
    const { unmount } = render(result.current.toast)
    // Saved without a destination, but no "Pick a destination" for another board.
    expect(screen.queryByRole('button', { name: 'Pick a destination' })).toBeNull()
    act(() => screen.getByRole('button', { name: 'Undo' }).click())
    unmount()
    expect(readFavourites()).toEqual([{ from: 'roma-street', to: null }])
    expect(result.current.saved).toBe(true)
  })
})
