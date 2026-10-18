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
