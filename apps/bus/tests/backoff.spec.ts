/**
 * Offline backoff (smoke round 9): under lie-fi a minute costs each board at most 10 /v1 calls and LIVE returns within
 * seconds of the first answer; offline the boards do not poll. Time-of-day independent: the departures are pinned.
 */
import { backoffSuite } from '@bft/ui/e2e/backoff.ts'
import { pinUpcoming } from './upcoming.ts'

backoffSuite({
  label: 'saved stop',
  path: '/stop/10802',
  pagesCache: 'bus-pages',
  departures: /\/v1\/bus\/stops\/10802\/departures/,
  pin: (context) => pinUpcoming(context),
  prepare: (page) =>
    page.addInitScript(() =>
      localStorage.setItem(
        'bft-bus-saved',
        JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
      ),
    ),
})
