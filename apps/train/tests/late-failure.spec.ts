/**
 * A late /v1 failure must not undo a reconnect (@bft/ui/e2e/late-failure.ts): the same page as backoff.spec.ts.
 */
import { lateFailureSuite } from '@bft/ui/e2e/late-failure.ts'
import { pinUpcoming } from './upcoming.ts'

lateFailureSuite({
  path: '/station/central',
  pagesCache: 'train-pages',
  departures: /\/v1\/train\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
})
