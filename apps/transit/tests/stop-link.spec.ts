/** R36-F1: BrisbaneTransit's old `/ferry?stop=` links (@bft/ui/e2e/ferry-stop-link.ts). */
import { ferryStopLinkSuite } from '@bft/ui/e2e/ferry-stop-link.ts'

// Ferry home at its canonical URL: bare /ferry has 301'd to /ferry/ since #215, a hop before the old link's 302.
ferryStopLinkSuite({ home: '/ferry/', base: '/ferry', title: 'Brisbane ferries' })
