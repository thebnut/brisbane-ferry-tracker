/**
 * Offline backoff (smoke round 9): under lie-fi a minute costs each board at most 10 /v1 calls and LIVE returns within
 * seconds of the first answer; offline the boards do not poll. Time-of-day independent: the departures are pinned.
 */
import { backoffSuite } from '@bft/ui/e2e/backoff.ts'
import { pinUpcoming } from './upcoming.ts'

backoffSuite({
  path: '/station/central',
  pagesCache: 'train-pages',
  departures: /\/v1\/train\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
  boards: 1, // Central
})
