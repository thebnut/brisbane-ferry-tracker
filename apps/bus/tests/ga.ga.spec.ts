/** GA4 on standalone BrisbaneBus (@bft/ui/e2e/ga.ts). */
import { gaSuite } from '@bft/ui/e2e/ga.ts'

gaSuite({
  siteMode: 'bus',
  boardPath: '/stop/10802',
  navLink: '/alerts',
  navPath: '/alerts',
  saveMode: 'bus',
  stopId: '10802',
})
