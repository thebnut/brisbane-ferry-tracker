/** R32-RT1 on the standalone bus stop board (@bft/ui/e2e/seed-connecting.ts). */
import { seedConnectingSizes } from '@bft/ui/e2e/seed-connecting.ts'
import { pinUpcoming } from './upcoming.ts'

seedConnectingSizes([
  { name: 'bus stop', path: '/stop/10802', departures: '**/__fixtures/v1/bus/stops/*/departures*', pin: pinUpcoming },
])
