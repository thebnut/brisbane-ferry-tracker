/**
 * Regression tests for Dev's smoke test round 3 (19 Oct 2026).
 * F1: an offline load must render the styled offline/scheduled board (or a styled offline page), never LIVE.
 */
import { offlineLoadSuite } from '@bft/ui/e2e/offline-suite.ts'

offlineLoadSuite({ path: '/ferry', unvisited: '/train/station/central', pagesCache: 'transit-pages' })
