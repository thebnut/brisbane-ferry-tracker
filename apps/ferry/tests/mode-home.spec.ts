/** THE-118 PR 8: the standalone home, the same mode home as BrisbaneTransit's tab (@bft/ui/e2e/mode-home.ts). */
import { type HomeSpec, headlineConnecting, modeHomeSuite, SAVED } from '@bft/ui/e2e/mode-home.ts'
import { pinUpcoming } from './upcoming.ts'

const HOME: HomeSpec = {
  mode: 'ferry',
  path: '/',
  base: '',
  title: 'Ferry',
  search: 'Find a terminal',
  popular: { title: 'All terminals', first: { name: 'Apollo Road', href: '/terminal/apollo-road' } },
  near: 'terminals',
  saved: SAVED.ferry,
  pin: (c) => pinUpcoming(c),
}

modeHomeSuite([HOME])
headlineConnecting(HOME, '**/__fixtures/v1/ferry/stops/*/departures*')
