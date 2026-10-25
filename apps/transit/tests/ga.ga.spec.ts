/** GA4 on BrisbaneTransit (@bft/ui/e2e/ga.ts): site_mode is "transit" on the mounted mode pages too. */
import { gaSuite } from '@bft/ui/e2e/ga.ts'

gaSuite({
  siteMode: 'transit',
  boardPath: '/bus/stop/10802',
  navLink: '/train',
  navPath: '/train',
  saveMode: 'bus',
  stopId: '10802',
})
