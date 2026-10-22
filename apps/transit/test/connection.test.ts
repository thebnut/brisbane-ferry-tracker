/** The header's connection state (THE-118 PR 2): Connecting first, LIVE only from the page's answer, OFFLINE only after a failure. */
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

  it('Connecting → Offline only after a request has failed', () => {
    // useOnline() turns false when a request fails (or times out): that is the failure.
    expect(connectionState({ live: false, pending: true, online: false })).toBe('offline')
    // An answer that is in but not live (an API error, an unavailable or stale feed) keeps the existing OFFLINE.
    expect(connectionState({ live: false, pending: false, online: true })).toBe('offline')
  })

  it('Live → Offline when a refresh fails or the browser goes offline', () => {
    expect(connectionState({ live: true, pending: false, online: false })).toBe('offline')
  })

  it('a page without live data claims nothing while online', () => {
    expect(connectionState({ live: undefined, online: true })).toBeNull()
    expect(connectionState({ live: undefined, online: false })).toBe('offline')
  })
})
