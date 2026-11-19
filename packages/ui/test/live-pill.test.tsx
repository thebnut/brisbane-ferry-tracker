/**
 * The header pill's three words (19 Nov 2026): LIVE, SCHEDULED (online but not live: an API error, a stale or
 * unavailable feed) and OFFLINE only when the device has no connection. And a saved card's failure line: a stop the
 * timetable no longer has (HTTP 404) is no outage.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LivePill } from '../src/chrome.tsx'
import { cardFailedText, isMissingStop } from '../src/states.tsx'

describe('LivePill', () => {
  it('LIVE when live and online', () => {
    const html = renderToStaticMarkup(<LivePill live />)
    expect(html).toContain('LIVE')
    expect(html).toContain('data-live-claim')
  })

  it('online + not live (API error, stale feed) => SCHEDULED, never OFFLINE', () => {
    const html = renderToStaticMarkup(<LivePill live={false} />)
    expect(html).toContain('SCHEDULED')
    expect(html).toContain('data-connection="scheduled"')
    expect(html).not.toContain('OFFLINE')
    expect(html).not.toContain('data-live-claim')
  })

  it('offline => OFFLINE, whatever the page says', () => {
    for (const live of [true, false]) {
      const html = renderToStaticMarkup(<LivePill live={live} offline />)
      expect(html).toContain('OFFLINE')
      expect(html).toContain('data-connection="offline"')
      expect(html).not.toContain('data-live-claim')
    }
  })
})

describe('a saved card that failed', () => {
  it('a 404 "unknown stop" says the stop has no services in the timetable', () => {
    const missing = { status: 404, body: '{"error":"unknown stop","detail":"317584"}' }
    expect(isMissingStop(missing)).toBe(true)
    expect(cardFailedText(missing)).toMatch(/current timetable/)
  })

  it('any other 404 is an ordinary failure (Codex r1)', () => {
    for (const error of [
      { status: 404 },
      { status: 404, body: '{"error":"not found"}' },
      { status: 410, body: '{"error":"unknown stop"}' },
    ])
      expect(isMissingStop(error)).toBe(false)
  })

  it('any other failure says live times are unavailable and we keep retrying', () => {
    for (const error of [{ status: 502 }, new TypeError('Failed to fetch'), null, undefined]) {
      expect(isMissingStop(error)).toBe(false)
      expect(cardFailedText(error)).toMatch(
        /unavailable right now\. We keep retrying; open the board for scheduled times/,
      )
    }
  })
})
