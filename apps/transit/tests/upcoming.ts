/**
 * Time-of-day independence (as apps/ferry/tests/upcoming.ts, #59): the fixture API replays a recorded timetable
 * against the real clock with synthetic RT only for trips starting within 45 minutes, so late at night a stop can have
 * nothing due within the hour and no LIVE row. This moves the first running departure of every polled departures
 * response to 10 minutes from now and, when the response is live, marks it live. `context.route` also covers the
 * service worker's requests. The server-rendered first paint is unchanged: refresh (or wait for a poll) after load.
 */
import type { BrowserContext } from '@playwright/test'

interface Row {
  status: string
  schedDep: number
  estDep: number | null
  schedArrTo: number | null
  estArrTo: number | null
}

export const pinUpcoming = (
  context: BrowserContext,
  glob = '**/__fixtures/v1/*/stops/*/departures*',
  /** How far ahead the pinned departure is, in seconds. */
  aheadS = 600,
) =>
  context.route(glob, async (route) => {
    try {
      const res = await route.fetch()
      const body: { rtState: string; departures?: Row[] } = await res.json()
      const d = body.departures?.find((x) => x.status !== 'cancelled' && x.status !== 'skipped')
      if (d) {
        const shift = Math.floor(Date.now() / 1000) + aheadS - (d.estDep ?? d.schedDep)
        d.schedDep += shift
        if (d.estDep != null) d.estDep += shift
        if (d.schedArrTo != null) d.schedArrTo += shift
        if (d.estArrTo != null) d.estArrTo += shift
        if (body.rtState === 'live') {
          d.status = 'live'
          d.estDep ??= d.schedDep
        }
      }
      await route.fulfill({ response: res, json: body })
    } catch (error) {
      // A request still in flight when the test ends (a refetch on reconnect): its context is closing.
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })
