/** THE-118 PR 8: the Ferry, Train and Bus tabs' homes (@bft/ui/e2e/mode-home.ts). */
import { type HomeSpec, headlineConnecting, modeHomeSuite, SAVED } from '@bft/ui/e2e/mode-home.ts'
import { pinUpcoming } from './upcoming.ts'

const HOMES: HomeSpec[] = [
  {
    mode: 'ferry',
    path: '/ferry',
    base: '/ferry',
    title: 'Ferry',
    search: 'Find a terminal',
    popular: { title: 'All terminals', first: { name: 'Apollo Road', href: '/terminal/apollo-road' } },
    near: 'terminals',
    saved: SAVED.ferry,
    pin: (c) => pinUpcoming(c),
  },
  {
    mode: 'train',
    path: '/train',
    base: '/train',
    title: 'Train',
    search: 'Find a station',
    popular: { title: 'Popular stations', first: { name: 'Central', href: '/station/central' } },
    near: 'stations',
    saved: SAVED.train,
    pin: (c) => pinUpcoming(c),
    allStations: { href: '/stations', heading: 'Choose your trip' },
  },
  {
    mode: 'bus',
    path: '/bus',
    base: '/bus',
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
  },
]

modeHomeSuite(HOMES)
headlineConnecting(HOMES[0] as HomeSpec, '**/__fixtures/v1/*/stops/*/departures*')
