/** R9, against the demo-allowed server: the first load's one-off demo clean-up keeps the first visit's own copy. */
import { demoCleanupSuite } from '@bft/ui/e2e/demo-cleanup.ts'

demoCleanupSuite({ path: '/station/central', pagesCache: 'train-pages' })
