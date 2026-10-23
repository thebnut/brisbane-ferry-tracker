/** R32-RT1 on every BrisbaneTransit board with an SSR seed (@bft/ui/e2e/seed-connecting.ts). */
import { seedConnectingSizes } from '@bft/ui/e2e/seed-connecting.ts'
import { pinUpcoming } from './upcoming.ts'

const departures = '**/__fixtures/v1/*/stops/*/departures*'
seedConnectingSizes([
  { name: 'bus stop', path: '/bus/stop/10802', departures, pin: pinUpcoming },
  { name: 'train station', path: '/train/station/central', departures, pin: pinUpcoming },
  { name: 'ferry terminal', path: '/ferry/terminal/bulimba', departures, pin: pinUpcoming },
])
