/** R32-RT1 on the standalone ferry terminal board (@bft/ui/e2e/seed-connecting.ts). */
import { seedConnectingSizes } from '@bft/ui/e2e/seed-connecting.ts'
import { pinUpcoming } from './upcoming.ts'

seedConnectingSizes([
  {
    name: 'ferry terminal',
    path: '/terminal/bulimba',
    departures: '**/__fixtures/v1/ferry/stops/*/departures*',
    pin: pinUpcoming,
  },
])
