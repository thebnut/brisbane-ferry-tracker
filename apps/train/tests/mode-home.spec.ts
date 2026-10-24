/** THE-118 PR 8: the standalone home, the same mode home as BrisbaneTransit's tab (@bft/ui/e2e/mode-home.ts). */
import { type HomeSpec, modeHomeSuite, SAVED } from '@bft/ui/e2e/mode-home.ts'
import { pinUpcoming } from './upcoming.ts'

const HOME: HomeSpec = {
  mode: 'train',
  path: '/',
  base: '',
  title: 'Train',
  search: 'Find a station',
  popular: { title: 'Popular stations', first: { name: 'Central', href: '/station/central' } },
  near: 'stations',
  saved: SAVED.train,
  pin: (c) => pinUpcoming(c),
  allStations: { href: '/stations', heading: 'Choose your trip' },
}

modeHomeSuite([HOME])
