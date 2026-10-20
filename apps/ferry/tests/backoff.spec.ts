/**
 * Offline backoff (smoke round 9): under lie-fi a minute costs each board at most 10 /v1 calls and LIVE returns within
 * seconds of the first answer; offline the boards do not poll. Time-of-day independent: the departures are pinned.
 */
import { backoffSuite } from '@bft/ui/e2e/backoff.ts'
import { pinUpcoming } from './upcoming.ts'

backoffSuite({
  path: '/',
  pagesCache: 'ferry-pages',
  departures: /\/v1\/ferry\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
  boards: 2, // outbound and inbound
  prepare: (page) =>
    page.addInitScript(() => {
      localStorage.setItem('brisbane-ferry-remember-selection', 'true')
      localStorage.setItem(
        'brisbane-ferry-selected-stops',
        JSON.stringify({
          outbound: { id: '317584', name: 'Bulimba' },
          inbound: { id: '317590', name: 'Riverside' },
        }),
      )
    }),
})
