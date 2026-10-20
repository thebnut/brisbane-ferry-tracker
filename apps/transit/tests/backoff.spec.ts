/**
 * Offline backoff (smoke round 9): under lie-fi a minute costs each board at most 10 /v1 calls and LIVE returns within
 * seconds of the first answer; offline the boards do not poll. Time-of-day independent: the departures are pinned.
 */
import { backoffSuite } from '@bft/ui/e2e/backoff.ts'
import { pinUpcoming } from './upcoming.ts'

// The lead's staging case (20 Oct, 04:06): the transit home with saved stops, here from every mode.
backoffSuite({
  label: 'transit home, saved across modes',
  path: '/',
  pagesCache: 'transit-pages',
  departures: /\/v1\/(ferry|train|bus)\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
  boards: 3, // ferry, train and bus saved cards
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
      localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
      localStorage.setItem(
        'bft-bus-saved',
        JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
      )
    }),
})
