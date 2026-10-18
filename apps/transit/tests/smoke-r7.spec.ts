/**
 * Regression tests for Dev's smoke test round 7 (19 Oct 2026).
 * T1: the transit home page (saved stops from every mode), reloaded while offline, must behave like the mode boards:
 * no LIVE before its own network answer, the offline banner at once, held for over a minute.
 */
import { offlineHoldSuite } from '@bft/ui/e2e/offline-hold.ts'
import type { Page } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

/** A ferry pair, a train station and a bus stop saved on this device (each app's own storage). */
export const saveAcrossModes = (page: Page) =>
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
  })

offlineHoldSuite({
  label: 'transit home, saved across modes',
  path: '/',
  rows: '[data-saved-time]',
  pagesCache: 'transit-pages',
  departures: /\/v1\/(ferry|train|bus)\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
  prepare: saveAcrossModes,
  lieFi: true,
  // The page itself takes up to the service worker's 4 s network timeout to come from its copy.
  bannerWithinMs: 8_000,
})
