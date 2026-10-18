/**
 * R6-B1 (found on bus, round 6): a board loaded online and then held offline must stay an honest offline timetable
 * board, then go LIVE again when the network returns. Time-of-day independent: the departures are pinned.
 */
import { offlineHoldSuite } from '@bft/ui/e2e/offline-hold.ts'
import { pinUpcoming } from './upcoming.ts'

offlineHoldSuite({
  path: '/',
  rows: '[data-testid=departure]',
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
