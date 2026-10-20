/**
 * A late /v1 failure must not undo a reconnect (@bft/ui/e2e/late-failure.ts): the same page as backoff.spec.ts.
 */
import { lateFailureSuite } from '@bft/ui/e2e/late-failure.ts'
import { pinUpcoming } from './upcoming.ts'

lateFailureSuite({
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
