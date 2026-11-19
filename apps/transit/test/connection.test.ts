/**
 * The header's connection state (THE-118 PR 2): Connecting first, LIVE only from the page's answer, OFFLINE only when
 * the device has no connection, SCHEDULED (neutral) for an answer that isn't live while online (19 Nov 2026).
 */
import { describe, expect, it } from 'vitest'
import { connectionState } from '../app/lib/connection.ts'

describe('connectionState', () => {
  it('starts as Connecting, never OFFLINE, while the first answer is on its way', () => {
    // The page's LIVE rule says "not live" with no data: that alone must not read as OFFLINE.
    expect(connectionState({ live: false, pending: true, online: true })).toBe('connecting')
    // Nor LIVE (a page whose rule defaults to live before it has data, e.g. the train trip while loading).
    expect(connectionState({ live: true, pending: true, online: true })).toBe('connecting')
  })

  it('Connecting → Live once the answer is live', () => {
    expect(connectionState({ live: true, pending: false, online: true })).toBe('live')
  })

  it('navigator offline (or a request that never reached the network) => OFFLINE', () => {
    // useOnline() is false while the browser is offline, or a request threw, timed out or came from the SW cache.
    expect(connectionState({ live: false, pending: true, online: false })).toBe('offline')
    expect(connectionState({ live: false, pending: false, online: false })).toBe('offline')
  })

  it('online + API error or stale/unavailable feed => SCHEDULED, never OFFLINE', () => {
    // An answer that is in but not live (an HTTP error, a stale or unavailable feed, one saved card failing): the
    // device is online, so the neutral pill. It said OFFLINE before (release review C3), read as "the site is down".
    expect(connectionState({ live: false, pending: false, online: true })).toBe('scheduled')
    expect(connectionState({ live: false, online: true })).not.toBe('offline')
  })

  it('Live → Offline when the browser goes offline or requests stop reaching the network', () => {
    expect(connectionState({ live: true, pending: false, online: false })).toBe('offline')
  })

  it('a page without live data claims nothing while online', () => {
    expect(connectionState({ live: undefined, online: true })).toBeNull()
    expect(connectionState({ live: undefined, online: false })).toBe('offline')
  })
})
