/**
 * Regression tests for Dev's smoke test round 8 (19 Oct 2026).
 * F1: a cold start (site data cleared, page from the HTTP cache offline) must leave OFFLINE within seconds of being
 * back online, and a departures call the API never answers must time out instead of holding the board offline.
 */
import { coldStartSuite } from '@bft/ui/e2e/cold-start.ts'
import { pinUpcoming } from './upcoming.ts'

coldStartSuite({
  path: '/',
  departures: /\/v1\/ferry\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
  firstRunDialog: 'Select ferry stops',
  // Each load is a first visit, as after Dev's "Clear site data": the stop selector opens every time.
  prepare: (page) => page.addInitScript(() => localStorage.removeItem('brisbane-ferry-selector-seen')),
})
