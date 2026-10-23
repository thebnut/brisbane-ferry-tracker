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
  path: '/terminal/bulimba?to=riverside',
  label: 'Bulimba ⇄ Riverside',
  prepare: selectStops,
  pin: pinUpcoming,
})
clockSkewSuite({ path: '/terminal/bulimba', label: 'a shared terminal link', pin: pinUpcoming })
