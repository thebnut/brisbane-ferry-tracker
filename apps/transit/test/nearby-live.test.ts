// @vitest-environment jsdom
import type { DeparturesResponse } from '@bft/core/contract'
import { pageLive, reportValue } from '@bft/ui/mode-home'
import { describe, expect, it } from 'vitest'
import { nearbyLiveState } from '../app/routes/nearby.tsx'

// Stand-ins: the page's isLive (liveState over a fresh answer) decides; only identity matters here.
const LIVE = { rtState: 'live' } as unknown as DeparturesResponse
const STALE = { rtState: 'stale' } as unknown as DeparturesResponse
const isLive = (d: DeparturesResponse | undefined) => d === LIVE

describe('Nearby’s header claim (P-42a1bd5-N1), reported like the mode homes', () => {
  it('no stops listed (no location yet, or none near): no claim, never OFFLINE', () => {
    expect(nearbyLiveState([], isLive)).toEqual({ live: undefined, pending: false })
  })

  it('stops waiting for their first answer: Connecting…, not OFFLINE', () => {
    expect(nearbyLiveState([{ data: undefined, failed: false }], isLive)).toEqual({
      live: false,
      pending: true,
    })
    expect(
      nearbyLiveState(
        [
          { data: LIVE, failed: false },
          { data: undefined, failed: false },
        ],
        isLive,
      ),
    ).toEqual({ live: false, pending: true })
  })

  it('LIVE once every listed stop answered live; OFFLINE over a stale or failed one', () => {
    expect(nearbyLiveState([{ data: LIVE, failed: false }], isLive)).toEqual({ live: true, pending: false })
    expect(
      nearbyLiveState(
        [
          { data: LIVE, failed: false },
          { data: STALE, failed: false },
        ],
        isLive,
      ),
    ).toEqual({ live: false, pending: false })
    expect(nearbyLiveState([{ data: undefined, failed: true }], isLive)).toEqual({
      live: false,
      pending: false,
    })
  })

  it('matches the mode homes’ pageLive for every pair of stop states (a Nearby row marks its live departures)', () => {
    // [stop, reportValue(live, pending, failed, liveRows)]: a row shows LIVE when its answer is live.
    const states: Array<
      [{ data: DeparturesResponse | undefined; failed: boolean }, Parameters<typeof reportValue>]
    > = [
      [{ data: undefined, failed: false }, [false, true, false, false]],
      [{ data: undefined, failed: true }, [false, false, true, false]],
      [{ data: LIVE, failed: false }, [true, false, false, true]],
      [{ data: STALE, failed: false }, [false, false, false, false]],
      [{ data: LIVE, failed: true }, [true, false, true, true]],
      [{ data: STALE, failed: true }, [false, false, true, false]],
    ]
    for (const a of states)
      for (const b of states) {
        const want = pageLive([reportValue(...a[1]), reportValue(...b[1])])
        expect(nearbyLiveState([a[0], b[0]], isLive), JSON.stringify([a[1], b[1]])).toEqual(want)
      }
  })
})
