/**
 * A late /v1 failure must not undo a reconnect (@bft/ui/e2e/late-failure.ts): the same page as backoff.spec.ts.
 */
import { lateFailureSuite } from '@bft/ui/e2e/late-failure.ts'
import { pinUpcoming } from './upcoming.ts'

lateFailureSuite({
  label: 'transit home, saved across modes',
  path: '/',
  pagesCache: 'transit-pages',
  departures: /\/v1\/(ferry|train|bus)\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
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
