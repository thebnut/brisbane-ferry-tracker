/**
 * R9 (follow-up to R8-T1), against the demo-allowed server: on staging the first load's one-off demo clean-up
 * deleted the home the service worker had just saved at install, so after a first visit to /ferry an offline `/`
 * gave the "page isn't saved" page in 2 of 6 runs.
 */
import { demoCleanupSuite } from '@bft/ui/e2e/demo-cleanup.ts'

demoCleanupSuite({ path: '/ferry', pagesCache: 'transit-pages', installPages: ['/'] })
