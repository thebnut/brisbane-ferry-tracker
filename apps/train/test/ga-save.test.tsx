// @vitest-environment jsdom
/** GA4 save_stop (@bft/ui/analytics-config): sent from the train star and onboarding, only for a save kept. */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStar } from '../app/components/TrainStar.tsx'
import { resaveTrain, saveTrain } from '../app/lib/onboarding.ts'
import { FAVOURITES_KEY } from '../app/lib/storage.ts'

const saveStop = vi.fn()
const station = (id: string) => ({ mode: 'train' as const, id, name: id })

beforeEach(() => {
  localStorage.clear()
  saveStop.mockClear()
  window.__bftGa = { saveStop } as unknown as NonNullable<Window['__bftGa']>
})
afterEach(() => {
  vi.restoreAllMocks()
  delete window.__bftGa
})

describe('train save_stop', () => {
  it('the star sends one for a save (the station, never the trip\'s "to"), none for the unsave', () => {
    const { result } = renderHook(() => useStar({ from: 'central', to: 'roma-street' }, 'Central'))
    act(() => result.current.toggle())
    expect(saveStop).toHaveBeenCalledExactlyOnceWith('train', 'central')
    act(() => result.current.toggle())
    expect(saveStop).toHaveBeenCalledOnce()
  })

  it('a stale "Save" (saved in another tab since) writes nothing and sends nothing', () => {
    const { result } = renderHook(() => useStar({ from: 'central', to: null }, 'Central'))
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: 'central', to: null }]))
    act(() => result.current.toggle())
    expect(saveStop).not.toHaveBeenCalled()
  })

  it('a save storage refuses sends nothing', () => {
    const { result } = renderHook(() => useStar({ from: 'central', to: null }, 'Central'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    act(() => result.current.toggle())
    expect(saveStop).not.toHaveBeenCalled()
  })

  it('onboarding and the Settings re-run send one per station newly kept', () => {
    saveTrain([station('central'), station('bowen-hills')])
    expect(saveStop.mock.calls).toEqual([
      ['train', 'central'],
      ['train', 'bowen-hills'],
    ])
    saveStop.mockClear()
    resaveTrain([station('bowen-hills'), station('milton')])
    expect(saveStop.mock.calls).toEqual([['train', 'milton']])
  })
})
