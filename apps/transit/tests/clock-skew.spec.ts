/**
 * Device clock skew and the useNow false LIVE (smoke round 15, R15-S1): @bft/ui/e2e/clock-skew.ts, on Dev's pages
 * (the Ferry, Train and Bus tabs) and on the transit home with saved stops (the useNow case was found there).
 */
import { clockSkewSuite } from '@bft/ui/e2e/clock-skew.ts'
import { test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const savedAcrossModes = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    )
  })

clockSkewSuite({ path: '/ferry/terminal/bulimba', pin: pinUpcoming })
clockSkewSuite({ path: '/ferry', label: 'ferry home', prepare: savedAcrossModes, pin: pinUpcoming })
clockSkewSuite({ path: '/train/station/central', pin: pinUpcoming })
clockSkewSuite({ path: '/bus/stop/10802', pin: pinUpcoming })
clockSkewSuite({
  path: '/',
  label: 'transit home, saved across modes',
  prepare: savedAcrossModes,
  pin: pinUpcoming,
  pendingSaysOffline: true,
})

test.describe('Nearby', () => {
  test.use({ geolocation: { latitude: -27.4717, longitude: 153.0206 }, permissions: ['geolocation'] })
  clockSkewSuite({
    path: '/nearby?lat=-27.4717&lon=153.0206',
    label: 'Nearby, CBD',
    pin: pinUpcoming,
    pendingSaysOffline: true,
  })
})
