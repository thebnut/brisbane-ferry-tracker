/**
 * R6-B1 (found on bus, round 6): a board loaded online and then held offline must stay an honest offline timetable
 * board, then go LIVE again when the network returns. Time-of-day independent: the departures are pinned.
 */
import { offlineHoldSuite } from '@bft/ui/e2e/offline-hold.ts'
import { pinUpcoming } from './upcoming.ts'

offlineHoldSuite({
  path: '/station/central',
  rows: '[data-testid=departure]',
  pagesCache: 'train-pages',
  departures: /\/v1\/train\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
})
