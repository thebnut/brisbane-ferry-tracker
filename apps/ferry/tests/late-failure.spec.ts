/**
 * A late /v1 failure must not undo a reconnect (@bft/ui/e2e/late-failure.ts): the same page as backoff.spec.ts.
 */
import { lateFailureSuite } from '@bft/ui/e2e/late-failure.ts'
import { pinUpcoming } from './upcoming.ts'

lateFailureSuite({
  path: '/terminal/bulimba?to=riverside',
  pagesCache: 'ferry-pages',
  departures: /\/v1\/ferry\/stops\/[^/]+\/departures/,
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
    }),
})
