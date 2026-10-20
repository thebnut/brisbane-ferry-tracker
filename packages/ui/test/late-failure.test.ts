// @vitest-environment jsdom
/**
 * A late /v1 failure must not undo a reconnect (#121's follow-up; staging R6-B1 saw LIVE take 17 s to return): a
 * failure from a call started before the network last answered is stale, and a reconnect inside onReconnect's 1 s
 * window runs at its end instead of being dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isOnline,
  LIVE_REQUEST_TIMEOUT_MS,
  onReconnect,
  probeWhileUnreachable,
  RECONNECT_PROBE_MS,
  reportOffline,
  reportOnline,
  SW_CACHE_HEADER,
  trackedFetch,
} from '../src/connectivity.ts'

/** A fetch whose answer the test settles: `ok()` answers from the network, `fail()` rejects as a lost connection. */
function pendingFetch() {
  let ok = () => {}
  let fail = () => {}
  const promise = new Promise<Response>((resolve, reject) => {
    ok = () => resolve(new Response('{}'))
    fail = () => reject(new TypeError('Failed to fetch'))
  })
  return { promise, ok, fail }
}

/** Stubs fetch with one pending answer per call, in order. */
function fetches(n: number) {
  const list = Array.from({ length: n }, pendingFetch)
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(() => (list[i++] as ReturnType<typeof pendingFetch>).promise),
  )
  return list
}

afterEach(() => {
  reportOnline()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('trackedFetch: a failure only counts if the call started after the network last answered', () => {
  it('success at t1, then a failure from a call started before t1: still online', async () => {
    const [early, good] = fetches(2) as [ReturnType<typeof pendingFetch>, ReturnType<typeof pendingFetch>]
    reportOffline()
    const a = trackedFetch('/v1/bus/stops/1/departures')
    const b = trackedFetch('/v1/alerts?mode=bus')
    good.ok()
    await b
    expect(isOnline()).toBe(true)
    early.fail()
    await expect(a).rejects.toThrow('Failed to fetch')
    // Stale for the connection, still an error for its own query.
    expect(isOnline()).toBe(true)
  })

  it('a failure from a call started after t1: offline', async () => {
    const [good, late] = fetches(2) as [ReturnType<typeof pendingFetch>, ReturnType<typeof pendingFetch>]
    reportOffline()
    const b = trackedFetch('/v1/alerts?mode=bus')
    good.ok()
    await b
    expect(isOnline()).toBe(true)
    const c = trackedFetch('/v1/bus/stops/1/departures')
    late.fail()
    await expect(c).rejects.toThrow()
    expect(isOnline()).toBe(false)
  })

  it('the same for a call that times out (lie-fi), and for one the service worker answered from its cache', async () => {
    vi.useFakeTimers()
    let cached = () => {}
    let good = () => {}
    const answers: Array<(init?: RequestInit) => Promise<Response>> = [
      // Hangs until the deadline aborts it, like the browser's fetch.
      (init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
      () =>
        new Promise((resolve) => {
          cached = () => resolve(new Response('{}', { headers: { [SW_CACHE_HEADER]: 'sw' } }))
        }),
      () =>
        new Promise((resolve) => {
          good = () => resolve(new Response('{}'))
        }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) =>
        (answers.shift() as (i?: RequestInit) => Promise<Response>)(init),
      ),
    )
    reportOffline()
    const a = trackedFetch('/v1/bus/stops/1/departures')
    a.catch(() => {})
    const b = trackedFetch('/v1/train/stops/central/departures')
    const c = trackedFetch('/v1/alerts')
    good()
    await c
    expect(isOnline()).toBe(true)
    // Started before that answer: neither marks the connection down.
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS)
    await expect(a).rejects.toThrow(`no answer within ${LIVE_REQUEST_TIMEOUT_MS} ms`)
    expect(isOnline()).toBe(true)
    cached()
    await b
    expect(isOnline()).toBe(true)
  })

  it("the browser's online event makes earlier calls' failures stale too", async () => {
    const [early] = fetches(1) as [ReturnType<typeof pendingFetch>]
    reportOffline()
    const a = trackedFetch('/v1/bus/stops/1/departures')
    window.dispatchEvent(new Event('online'))
    expect(isOnline()).toBe(true)
    early.fail()
    await expect(a).rejects.toThrow()
    expect(isOnline()).toBe(true)
  })
})

describe('onReconnect: a reconnect inside the 1 s window runs at its end (coalesced), never dropped', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reportOffline()
  })

  it('the repro: online event, the board fails, another call answers 0.6 s later: the boards ask again at 1 s', () => {
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    expect(back).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    reportOffline() // the board's reconnect request failed (started after the event: not stale)
    vi.advanceTimersByTime(300)
    reportOnline() // alerts reached the network: the probe is cancelled
    expect(back).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(399)
    expect(back).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(back).toHaveBeenCalledTimes(2)
    off()
  })

  it('a burst of flaps inside the window gives exactly one trailing refetch', () => {
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(100)
      reportOffline()
      reportOnline()
    }
    expect(back).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    expect(back).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(10_000)
    expect(back).toHaveBeenCalledTimes(2)
    off()
  })

  it('going offline again before it fires cancels it; the next reconnect refetches', () => {
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(200)
    reportOffline()
    reportOnline()
    vi.advanceTimersByTime(200)
    reportOffline()
    vi.advanceTimersByTime(5_000)
    expect(back).toHaveBeenCalledTimes(1)
    reportOnline()
    expect(back).toHaveBeenCalledTimes(2)
    off()
  })

  it('no refetch storm: a board failing at every attempt while another call gets through, for a minute (Codex r1)', () => {
    const back = vi.fn(() => {
      // Each refetch: the board fails 30 ms in, another call reaches the network 60 ms in.
      setTimeout(reportOffline, 30)
      setTimeout(reportOnline, 60)
    })
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(60_000)
    // The online event's refetch and one trailing refetch; then the board waits for its own poll.
    expect(back).toHaveBeenCalledTimes(2)
    // A reconnect a second after that trailing refetch's window starts the next episode (and its one trailing).
    reportOffline()
    reportOnline()
    vi.advanceTimersByTime(60_000)
    expect(back).toHaveBeenCalledTimes(4)
    off()
  })

  it('leaves no timer behind once unsubscribed', () => {
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    reportOffline()
    reportOnline()
    off()
    vi.advanceTimersByTime(5_000)
    expect(back).toHaveBeenCalledTimes(1)
  })
})

describe('probeWhileUnreachable: a probe cancelled because a call answered', () => {
  it('leaves nothing unreachable unprobed: the next failure probes again, at 2.5 s', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const probe = vi.fn()
    const off = probeWhileUnreachable(probe)
    reportOffline()
    vi.advanceTimersByTime(1_000)
    reportOnline() // cancels the pending probe
    vi.advanceTimersByTime(60_000)
    expect(probe).not.toHaveBeenCalled()
    reportOffline()
    vi.advanceTimersByTime(RECONNECT_PROBE_MS)
    expect(probe).toHaveBeenCalledTimes(1)
    off()
  })
})
