/**
 * R6-B1 (round 6): Dev's bus stop, as the transit site mounts it, held offline for over a minute must stay an honest
 * offline timetable board, then go LIVE again when the network returns. Time-of-day independent: pinned departures.
 */
import { offlineHoldSuite } from '@bft/ui/e2e/offline-hold.ts'
import { pinUpcoming } from './upcoming.ts'

offlineHoldSuite({
  path: '/bus/stop/10802',
  rows: '[data-testid=departure]',
  pagesCache: 'transit-pages',
  departures: /\/v1\/bus\/stops\/10802\/departures/,
  pin: (context) => pinUpcoming(context),
})
