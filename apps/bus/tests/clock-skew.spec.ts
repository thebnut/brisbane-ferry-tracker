/** Device clock skew and the useNow false LIVE (smoke round 15, R15-S1): @bft/ui/e2e/clock-skew.ts. */
import { clockSkewSuite } from '@bft/ui/e2e/clock-skew.ts'
import { pinUpcoming } from './upcoming.ts'

clockSkewSuite({ path: '/stop/10802', pin: pinUpcoming })
