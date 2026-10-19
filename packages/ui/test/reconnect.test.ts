// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('onReconnect: the browser events it hears through the shared listeners (offline backoff)', () => {
  it('refetches at the online event even if nothing had failed, and not when a healthy page is shown', async () => {
    const { onReconnect } = await import('../src/connectivity.ts')
    const now = vi.spyOn(Date, 'now')
    let t = 2_000_000
    now.mockImplementation(() => t)
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    expect(back).toHaveBeenCalledTimes(1)
    t += 5_000
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    hidden.mockRestore()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(back).toHaveBeenCalledTimes(1)
    off()
    now.mockRestore()
  })

  it('shown again while API calls are failing, refetches at once', async () => {
    const { onReconnect, reportOffline, reportOnline } = await import('../src/connectivity.ts')
    const now = vi.spyOn(Date, 'now')
    let t = 3_000_000
    now.mockImplementation(() => t)
    const back = vi.fn()
    const off = onReconnect(back)
    reportOffline()
    t += 5_000
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(back).not.toHaveBeenCalled()
    hidden.mockRestore()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(back).toHaveBeenCalledTimes(1)
    off()
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

describe('probing while the connection is down without the browser knowing (R7), backing off', () => {
  /** Times (ms after `from`) at which `probe` was called, with the jitter as given by `random`. */
  async function probeTimes(random: number, steps: number[], before?: () => void) {
    const { probeWhileUnreachable, reportOffline } = await import('../src/connectivity.ts')
    vi.spyOn(Math, 'random').mockReturnValue(random)
    const times: number[] = []
    const from = Date.now()
    const off = probeWhileUnreachable(() => times.push(Date.now() - from))
    before?.()
    reportOffline()
    for (const ms of steps) vi.advanceTimersByTime(ms)
    return { times, off }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(async () => {
    const { reportOnline } = await import('../src/connectivity.ts')
    reportOnline()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('waits 2.5 s, then doubles each wait up to 60 s (no jitter at random 0)', async () => {
    const { times, off } = await probeTimes(0, [300_000])
    expect(times).toEqual([2_500, 7_500, 17_500, 37_500, 77_500, 137_500, 197_500, 257_500])
    off()
  })

  it('jitter only shortens a wait, by at most a fifth, so the cap holds', async () => {
    const { times, off } = await probeTimes(0.999_999, [300_000])
    const waits = times.map((t, i) => t - (times[i - 1] ?? 0))
    const nominal = [2_500, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000]
    waits.slice(0, nominal.length).forEach((w, i) => {
      expect(w).toBeLessThanOrEqual(nominal[i] as number)
      expect(w).toBeGreaterThanOrEqual((nominal[i] as number) * 0.8)
    })
    expect(Math.max(...waits)).toBeLessThanOrEqual(60_000)
    off()
  })

  it('a lie-fi minute costs at most 5 probes (it was 24 at a fixed 2.5 s)', async () => {
    for (const random of [0, 0.5, 0.999_999]) {
      const { times, off } = await probeTimes(random, [60_000])
      expect(times.length).toBeLessThanOrEqual(5)
      expect(times.length).toBeGreaterThanOrEqual(4)
      off()
      const { reportOnline } = await import('../src/connectivity.ts')
      reportOnline()
    }
  })

  it('stops once a call gets through, and the next outage starts at 2.5 s again', async () => {
    const { reportOffline, reportOnline } = await import('../src/connectivity.ts')
    const { times, off } = await probeTimes(0, [40_000])
    expect(times).toEqual([2_500, 7_500, 17_500, 37_500])
    reportOnline()
    vi.advanceTimersByTime(120_000)
    expect(times.length).toBe(4)
    reportOffline()
    vi.advanceTimersByTime(2_500)
    expect(times.length).toBe(5)
    off()
  })

  it("starts over at the browser's online event (which also ends the outage)", async () => {
    const { reportOffline } = await import('../src/connectivity.ts')
    const { times, off } = await probeTimes(0, [40_000])
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(120_000)
    expect(times.length).toBe(4)
    reportOffline()
    vi.advanceTimersByTime(2_500)
    expect(times.length).toBe(5)
    off()
  })

  it('never probes while navigator.onLine is false (the online event does it), nor while hidden', async () => {
    const { times, off } = await probeTimes(0, [5_000])
    expect(times).toEqual([2_500])
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    vi.advanceTimersByTime(300_000)
    expect(times).toEqual([2_500])
    onLine.mockRestore()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(300_000)
    expect(times).toEqual([2_500])
    hidden.mockRestore()
    off()
  })

  it('shown again, it starts over at 2.5 s, however far the waits had grown', async () => {
    const { times, off } = await probeTimes(0, [140_000])
    expect(times.length).toBe(6)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(30_000)
    hidden.mockRestore()
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(2_500)
    expect(times.length).toBe(7)
    expect((times[6] as number) - 170_000).toBe(2_500)
    off()
  })

  it('leaves no timer behind once unsubscribed', async () => {
    const { times, off } = await probeTimes(0, [10_000])
    expect(vi.getTimerCount()).toBe(1)
    off()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(300_000)
    expect(times).toEqual([2_500, 7_500])
  })
})

describe("pollEvery: a live query's refetchInterval (offline backoff)", () => {
  afterEach(async () => {
    const { reportOnline } = await import('../src/connectivity.ts')
    reportOnline()
    vi.restoreAllMocks()
  })
  /** A TanStack query stand-in: `fail` records a failed fetch (errorUpdatedAt from `at`), `succeed` a good one. */
  const query = () => {
    const q = { state: { status: 'success', errorUpdateCount: 0, errorUpdatedAt: 0 } }
    return {
      q,
      fail(at: number) {
        q.state = { status: 'error', errorUpdateCount: q.state.errorUpdateCount + 1, errorUpdatedAt: at }
      },
      succeed() {
        q.state = { ...q.state, status: 'success' }
      },
    }
  }

  it('polls every 15 s while calls get through, as before', async () => {
    const { pollEvery } = await import('../src/connectivity.ts')
    expect(pollEvery(15_000)(query().q)).toBe(15_000)
    expect(pollEvery(60_000)(query().q)).toBe(60_000)
  })

  it('never polls while the browser says it is offline', async () => {
    const { pollEvery, reportOffline } = await import('../src/connectivity.ts')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const b = query()
    expect(pollEvery(15_000)(b.q)).toBe(false)
    b.fail(1_000)
    expect(pollEvery(15_000)(b.q)).toBe(false)
    reportOffline()
    expect(pollEvery(15_000)(b.q)).toBe(false)
  })

  it('under lie-fi leaves it to the probe, backing it up at the longest wait', async () => {
    const { BACKOFF_MAX_MS, pollEvery, reportOffline } = await import('../src/connectivity.ts')
    reportOffline()
    expect(pollEvery(15_000)(query().q)).toBe(BACKOFF_MAX_MS)
    expect(BACKOFF_MAX_MS).toBe(60_000)
  })

  it('HTTP errors in a row double the wait, 15 s up to 60 s, and a good answer brings back 15 s (Codex r1)', async () => {
    const { pollEvery } = await import('../src/connectivity.ts')
    const poll = pollEvery(15_000)
    const b = query()
    expect(poll(b.q)).toBe(15_000)
    // Error times ending in 000 ms: no jitter.
    const waits = [1, 2, 3, 4, 5].map((i) => {
      b.fail(i * 1_000_000)
      return poll(b.q)
    })
    expect(waits).toEqual([15_000, 30_000, 60_000, 60_000, 60_000])
    // A query with no data yet is 'pending' again while it asks: still backing off.
    b.q.state = { ...b.q.state, status: 'pending' }
    expect(poll(b.q)).toBe(60_000)
    b.succeed()
    expect(poll(b.q)).toBe(15_000)
    b.fail(9_000_000)
    expect(poll(b.q)).toBe(15_000)
  })

  it('jitter only shortens a wait, by at most a fifth, so the cap holds', async () => {
    const { pollEvery } = await import('../src/connectivity.ts')
    const poll = pollEvery(15_000)
    for (let ms = 0; ms < 1000; ms += 37) {
      const b = query()
      poll(b.q)
      for (let i = 0; i < 4; i++) b.fail(1_000_000 * (i + 1) + ms)
      const wait = poll(b.q) as number
      expect(wait).toBeLessThanOrEqual(60_000)
      expect(wait).toBeGreaterThan(48_000)
    }
  })

  it('gives the same wait on every read of one failure (a new value would restart the timer at each render)', async () => {
    const { pollEvery } = await import('../src/connectivity.ts')
    const poll = pollEvery(15_000)
    const b = query()
    poll(b.q)
    b.fail(1_031_437)
    b.fail(2_031_437)
    const first = poll(b.q)
    vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    for (let i = 0; i < 5; i++) expect(poll(b.q)).toBe(first)
  })

  it('never reads a server time, so a device clock behind the server still backs off (Codex r2)', async () => {
    const { pollEvery } = await import('../src/connectivity.ts')
    const poll = pollEvery(15_000)
    // Initial data stamped by the server five minutes ahead of this device: only the count matters.
    const b = query()
    b.q.state = { ...b.q.state, dataUpdatedAt: Date.now() + 300_000 } as typeof b.q.state
    poll(b.q)
    for (let i = 1; i <= 3; i++) b.fail(Date.now() - 1_000 + i * 1_000)
    expect(poll(b.q)).toBeGreaterThan(48_000)
  })

  it("starts over at the browser's online, offline and visibilitychange events (Codex r2)", async () => {
    const { pollEvery } = await import('../src/connectivity.ts')
    const poll = pollEvery(15_000)
    for (const fire of [
      () => window.dispatchEvent(new Event('online')),
      () => window.dispatchEvent(new Event('offline')),
      () => document.dispatchEvent(new Event('visibilitychange')),
    ]) {
      const b = query()
      poll(b.q)
      for (let i = 1; i <= 4; i++) b.fail(i * 1_000_000)
      expect(poll(b.q)).toBe(60_000)
      fire()
      // The event's own attempt is still in flight: the first wait. It fails too: still the first wait, then 30 s.
      expect(poll(b.q)).toBe(15_000)
      b.fail(7_000_000)
      expect(poll(b.q)).toBe(15_000)
      b.fail(8_000_000)
      expect(poll(b.q)).toBe(30_000)
    }
  })
})

describe('probeDueByMs: the e2e ceiling for the next probe, from the schedule constants', () => {
  it('is the first probe that cannot have gone early (jitter) before the network returned', async () => {
    const { probeDueByMs } = await import('../e2e/backoff.ts')
    // 2.5, 7.5, 17.5, 37.5, 77.5, 137.5 s at full length; at most a fifth shorter each.
    expect(probeDueByMs(0)).toBe(2_500)
    expect(probeDueByMs(2_500)).toBe(7_500)
    // Bus R7: the network back ~16-17.5 s into the outage; the 17.5 s probe may have gone at 14 s.
    expect(probeDueByMs(17_500)).toBe(37_500)
    expect(probeDueByMs(61_000)).toBe(77_500)
    expect(probeDueByMs(63_000)).toBe(137_500)
  })
})
