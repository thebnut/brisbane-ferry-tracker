/**
 * Time-of-day independence for tests that need a countdown chip or a LIVE row. The fixture API replays a recorded
 * timetable against the real clock, and its synthetic RT only covers trips starting within 45 minutes, so late at
 * night a pair can have nothing due within the hour and no LIVE row. This moves the first running departure of every
 * polled departures response to 10 minutes from now (arrival shifted with it) and, when the response is live, marks
 * it live. The server-rendered first paint is unchanged, so call `refreshBoards` after the page loads to fetch the
 * pinned data at once instead of waiting for the 15 s poll. `context.route` also covers the service worker's requests.
 */
import type { BrowserContext, Page } from '@playwright/test'

interface Row {
  status: string
  schedDep: number
  estDep: number | null
  schedArrTo: number | null
  estArrTo: number | null
}

export const pinUpcoming = (context: BrowserContext) =>
  context.route('**/__fixtures/v1/ferry/stops/*/departures*', async (route) => {
    const res = await route.fetch()
    const body: { rtState: string; departures?: Row[] } = await res.json()
    const d = body.departures?.find((x) => x.status !== 'cancelled' && x.status !== 'skipped')
    if (d) {
      const shift = Math.floor(Date.now() / 1000) + 600 - (d.estDep ?? d.schedDep)
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
  })

/** Fetch the boards now (the header Refresh button) so routed responses replace the server-rendered data. */
export const refreshBoards = (page: Page) => page.getByRole('button', { name: 'Refresh' }).click()
