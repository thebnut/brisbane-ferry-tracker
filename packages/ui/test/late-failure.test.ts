// @vitest-environment jsdom
/**
 * A late /v1 failure must not undo a reconnect (#121's follow-up; staging R6-B1 saw LIVE take 17 s to return): a
 * reconnect inside onReconnect's 1 s window runs at its end instead of being dropped, backing off if it keeps recurring.
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

  /** Times (ms after the online event) of the refetches in a minute where every refetch fails and then recovers. */
  const loop = (recoverMs: (n: number) => number) => {
    const times: number[] = []
    const from = Date.now()
    let n = 0
    const off = onReconnect(() => {
      times.push(Date.now() - from)
      // The board fails 30 ms in; another call reaches the network (cancelling the probe) after `recoverMs`.
      setTimeout(reportOffline, 30)
      setTimeout(reportOnline, recoverMs(n++))
    })
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(59_000)
    off()
    return times
  }

  it('no refetch storm: a board failing at every attempt backs off to its poll rate (Codex r1)', () => {
    // Was a refetch every second; now 1, 2, 4, 8 s apart, then every 15 s (the board's own poll).
    expect(loop(() => 60)).toEqual([0, 1_000, 3_000, 7_000, 15_000, 30_000, 45_000])
  })

  it('no refetch storm with alternating latency either (Codex r2: it was 58 a minute)', () => {
    // The answers after 1.1 s are plain reconnects (as before this fix); the trailing ones back off between them.
    expect(loop((n) => (n % 2 ? 1_100 : 60))).toEqual([
      0, 1_000, 2_100, 4_100, 5_200, 9_200, 10_300, 18_300, 19_400, 34_400, 35_500, 50_500, 51_600,
    ])
  })

  it('a second race soon after the first is still recovered, in 2 s (Codex r3)', () => {
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(100)
    reportOffline()
    vi.advanceTimersByTime(200)
    reportOnline()
    vi.advanceTimersByTime(700)
    expect(back).toHaveBeenCalledTimes(2) // the trailing refetch at 1 s
    vi.advanceTimersByTime(2_000)
    reportOffline()
    reportOnline() // a reconnect at 3 s: refetch at once
    expect(back).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(100)
    reportOffline()
    vi.advanceTimersByTime(200)
    reportOnline() // the same race again: the trailing refetch now waits 2 s from the 3 s refetch
    vi.advanceTimersByTime(1_699)
    expect(back).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(1)
    expect(back).toHaveBeenCalledTimes(4)
    off()
  })

  it('the backoff starts over after 15 s without a trailing refetch', () => {
    const back = vi.fn()
    const off = onReconnect(back)
    window.dispatchEvent(new Event('online'))
    reportOffline()
    reportOnline()
    vi.advanceTimersByTime(1_000)
    expect(back).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(20_000)
    reportOffline()
    reportOnline()
    expect(back).toHaveBeenCalledTimes(3)
    reportOffline()
    reportOnline()
    vi.advanceTimersByTime(1_000)
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
