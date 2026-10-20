// @vitest-environment jsdom
/**
 * A late /v1 failure must not undo a reconnect (#121's follow-up; staging R6-B1 saw LIVE take 17 s to return): a
 * reconnect inside onReconnect's 1 s window runs at its end instead of being dropped, at most once per 15 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  onReconnect,
  probeWhileUnreachable,
  RECONNECT_PROBE_MS,
  reportOffline,
  reportOnline,
} from '../src/connectivity.ts'

afterEach(() => {
  reportOnline()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
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

  it('no refetch storm with alternating latency either: one trailing refetch per 15 s (Codex r2)', () => {
    let n = 0
    const back = vi.fn(() => {
      // Each refetch: the board fails 30 ms in; another call answers 60 ms or 1.1 s in, alternately.
      setTimeout(reportOffline, 30)
      setTimeout(reportOnline, n++ % 2 ? 1_100 : 60)
    })
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(60_000)
    // The online event's refetch, one trailing, the next reconnect after its window; then one inside the window, dropped.
    expect(back).toHaveBeenCalledTimes(3)
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
