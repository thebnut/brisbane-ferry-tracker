/** R32-RT1 on the standalone train station board (@bft/ui/e2e/seed-connecting.ts). */
import { seedConnectingSizes } from '@bft/ui/e2e/seed-connecting.ts'
import { pinUpcoming } from './upcoming.ts'

seedConnectingSizes([
  { name: 'train station', path: '/station/central', departures: '**/__fixtures/v1/train/stops/*/departures*', pin: pinUpcoming },
])
