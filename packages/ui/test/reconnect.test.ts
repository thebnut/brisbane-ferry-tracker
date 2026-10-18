// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

describe('onReconnect (R3-X9)', () => {
  it('refetches once when the browser comes back online, and when a call reaches the network after failures', async () => {
    const { onReconnect, reportOffline, reportOnline } = await import('../src/connectivity.ts')
    const calls: number[] = []
    const now = vi.spyOn(Date, 'now')
    let t = 1_000_000
    now.mockImplementation(() => t)
    const off = onReconnect(() => calls.push(t))
    reportOffline()
    expect(calls).toEqual([])
    window.dispatchEvent(new Event('online'))
    expect(calls.length).toBe(1)
    t += 5_000
    reportOffline()
    reportOnline()
    expect(calls.length).toBe(2)
    t += 5_000
    reportOffline()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(calls.length).toBe(3)
    off()
    t += 5_000
    window.dispatchEvent(new Event('online'))
    expect(calls.length).toBe(3)
    now.mockRestore()
    reportOnline()
  })
})

describe('a screen that needs the network, opened offline (R7-T2)', () => {
  it('counts fetch failures and anything while offline as offline, not other errors', async () => {
    const { isOfflineFailure, reportOffline, reportOnline } = await import('../src/connectivity.ts')
    expect(isOfflineFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isOfflineFailure(new TypeError('Load failed'))).toBe(true)
    expect(isOfflineFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isOfflineFailure(new TypeError("Cannot read properties of undefined (reading 'fetch')"))).toBe(
      false,
    )
    expect(isOfflineFailure(new Error('boom'))).toBe(false)
    reportOffline()
    expect(isOfflineFailure(new Error('boom'))).toBe(true)
    reportOnline()
  })

  it('retries on reconnect and every interval until unsubscribed', async () => {
    vi.useFakeTimers()
    const { retryWhenBack } = await import('../src/connectivity.ts')
    const retry = vi.fn()
    const off = retryWhenBack(retry, 10_000)
    vi.advanceTimersByTime(10_000)
    expect(retry).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_500)
    window.dispatchEvent(new Event('online'))
    expect(retry).toHaveBeenCalledTimes(2)
    off()
    vi.advanceTimersByTime(30_000)
    window.dispatchEvent(new Event('online'))
    expect(retry).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
