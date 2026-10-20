/** Device clock skew and the useNow false LIVE (smoke round 15, R15-S1): @bft/ui/e2e/clock-skew.ts. */
import { clockSkewSuite } from '@bft/ui/e2e/clock-skew.ts'
import { pinUpcoming } from './upcoming.ts'

const selectStops = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })

clockSkewSuite({
  path: '/',
  label: 'ferry home, Bulimba ⇄ Riverside',
  prepare: selectStops,
  pin: pinUpcoming,
})
clockSkewSuite({ path: '/?stop=317584', label: 'ferry home from a shared link', pin: pinUpcoming })
