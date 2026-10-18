/**
 * Regression tests for Dev's smoke test round 3 (19 Oct 2026).
 * X9: back online, the offline state clears at once (a refetch), not at the next poll.
 * F1: an offline load must render the styled offline/scheduled board (or a styled offline page), never LIVE.
 */
import { offlineLoadSuite, reconnectSuite } from '@bft/ui/e2e/offline-suite.ts'

offlineLoadSuite({ path: '/station/central', unvisited: '/station/roma-street', pagesCache: 'train-pages' })

reconnectSuite({ path: '/station/central' })
