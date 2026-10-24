// @vitest-environment jsdom
/**
 * The stop search loads its index lazily, on an idle callback (or a 200 ms timer without one). Unmounting cancels it,
 * so it never fires after the page (or a test's environment) is gone: header-idle.test.tsx flaked with "window is not
 * defined" when the timer outlived its file.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const enabledCalls: boolean[] = []
vi.mock('../app/lib/mode.ts', () => ({
  useApi: () => ({ mode: { fixtures: false, rt: null }, fetcher: vi.fn() }),
}))
vi.mock('../app/lib/queries.ts', () => ({
  retryFailedLists: vi.fn(),
  useStopIndex: (_fetcher: unknown, _mode: unknown, enabled: boolean) => {
    enabledCalls.push(enabled)
    return { index: null, searchStops: null, isError: false, retry: vi.fn() }
  },
}))

const { useStopSearch } = await import('../app/components/SearchPanel.tsx')
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void) => number
  cancelIdleCallback?: (id: number) => void
}
const w = window as IdleWindow

describe('stop search idle start', () => {
  beforeEach(() => {
    enabledCalls.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    delete w.requestIdleCallback
    delete w.cancelIdleCallback
  })

  it('without requestIdleCallback: starts after 200 ms while mounted', async () => {
    delete w.requestIdleCallback
    renderHook(() => useStopSearch(''))
    expect(enabledCalls.at(-1)).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(enabledCalls.at(-1)).toBe(true)
  })

  it('without requestIdleCallback: unmounting clears the pending timer', () => {
    delete w.requestIdleCallback
    const { unmount } = renderHook(() => useStopSearch(''))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('with requestIdleCallback: unmounting cancels the idle callback', () => {
    w.requestIdleCallback = vi.fn(() => 7)
    w.cancelIdleCallback = vi.fn()
    const { unmount } = renderHook(() => useStopSearch(''))
    expect(w.requestIdleCallback).toHaveBeenCalledTimes(1)
    unmount()
    expect(w.cancelIdleCallback).toHaveBeenCalledWith(7)
    expect(vi.getTimerCount()).toBe(0)
  })
})
