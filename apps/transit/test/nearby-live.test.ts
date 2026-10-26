// @vitest-environment jsdom
import type { DeparturesResponse } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { nearbyLiveState } from '../app/routes/nearby.tsx'

// Stand-ins: the page's isLive (liveState over a fresh answer) decides; only identity matters here.
const LIVE = { rtState: 'live' } as unknown as DeparturesResponse
const STALE = { rtState: 'stale' } as unknown as DeparturesResponse
const isLive = (d: DeparturesResponse | undefined) => d === LIVE

describe('Nearby’s header claim (P-42a1bd5-N1)', () => {
  it('no stops listed (no location yet, or none near): no claim, never OFFLINE', () => {
    expect(nearbyLiveState([], isLive)).toEqual({ live: undefined, pending: false })
  })

  it('before any answer: Connecting… while a stop waits; OFFLINE only once every stop has failed', () => {
    const waiting = { data: undefined, failed: false }
    const failed = { data: undefined, failed: true }
    expect(nearbyLiveState([waiting], isLive)).toEqual({ live: false, pending: true })
    expect(nearbyLiveState([failed, waiting], isLive)).toEqual({ live: false, pending: true })
    expect(nearbyLiveState([failed, failed], isLive)).toEqual({ live: false, pending: false })
  })

  it('once a stop has answered, as before (R15-S1): LIVE while every answered stop is live; waiting or failed stops left out', () => {
    const ok = { data: LIVE, failed: false }
    expect(nearbyLiveState([ok], isLive)).toEqual({ live: true, pending: false })
    expect(nearbyLiveState([ok, { data: undefined, failed: false }], isLive)).toEqual({
      live: true,
      pending: false,
    })
    expect(nearbyLiveState([ok, { data: undefined, failed: true }], isLive)).toEqual({
      live: true,
      pending: false,
    })
    expect(nearbyLiveState([ok, { data: STALE, failed: false }], isLive)).toEqual({
      live: false,
      pending: false,
    })
    // A failed refetch that kept its data is judged by that data (liveState ages it).
    expect(nearbyLiveState([{ data: LIVE, failed: true }], isLive)).toEqual({ live: true, pending: false })
  })
})
