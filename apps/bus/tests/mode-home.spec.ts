/** THE-118 PR 8: the standalone home, the same mode home as BrisbaneTransit's tab (@bft/ui/e2e/mode-home.ts). */
import { type HomeSpec, modeHomeSuite, SAVED } from '@bft/ui/e2e/mode-home.ts'
import { pinUpcoming } from './upcoming.ts'

const HOME: HomeSpec = {
  mode: 'bus',
  path: '/',
  base: '',
  title: 'Bus',
  // Phones on the standalone site: the thumb sheet's "Find a stop".
  search: /^(Find a stop|Stop name or number)$/,
  popular: {
    title: 'Busy stops',
    first: { name: 'Cultural Centre station, platform 1', href: '/stop/10802' },
  },
  near: 'stops',
  saved: SAVED.bus,
  pin: (c) => pinUpcoming(c),
}

modeHomeSuite([HOME])
