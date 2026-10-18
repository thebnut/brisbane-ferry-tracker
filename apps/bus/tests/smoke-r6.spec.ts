/**
 * Regression test for Dev's smoke test round 6 (19 Oct 2026), R6-B1: a bus stop loaded online, then held offline,
 * flipped after a while to "Live times delayed", an old "Updated" time and "No buses due", then to "Offline: no saved
 * timetable for this stop". Saved and unsaved (Dev's wasn't saved). Time-of-day independent: the departures are
 * pinned (tests/upcoming.ts).
 */
import { offlineHoldSuite } from '@bft/ui/e2e/offline-hold.ts'
import { pinUpcoming } from './upcoming.ts'

for (const saved of [false, true])
  offlineHoldSuite({
    label: saved ? 'saved stop' : 'unsaved stop',
    path: '/stop/10802',
    rows: '[data-testid=departure]',
    pagesCache: 'bus-pages',
    departures: /\/v1\/bus\/stops\/10802\/departures/,
    pin: (context) => pinUpcoming(context),
    prepare: saved
      ? (page) =>
          page.addInitScript(() =>
            localStorage.setItem(
              'bft-bus-saved',
              JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
            ),
          )
      : undefined,
  })
