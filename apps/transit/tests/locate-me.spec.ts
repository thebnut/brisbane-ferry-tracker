/**
 * THE-112: locate-me on the Around you map and on the onboarding map picker. Around a chosen place (?lat=&lon=) the map
 * shows where you are without moving and goes there on a tap. The picker opens on you once location is allowed;
 * after panning away a tap brings it back, and picks still go into the tray. With location blocked the button says
 * so on the map. Its own file because launch options (WebGL) force a new worker.
 */
import {
  allowLocation,
  expectDeniedOnTap,
  expectLocatesOnTap,
  offCentre,
  panAway,
  youAreHere,
} from '@bft/ui/e2e/locate-me.ts'
import { WEBGL_LAUNCH } from '@bft/ui/e2e/map-fonts.ts'
import { expectPrompt, FIRST_VISIT, prompt } from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ launchOptions: WEBGL_LAUNCH })

// Cultural Centre: the nearby page's chosen place, away from the device's position (New Farm).
const AROUND = '/nearby?lat=-27.4732&lon=153.0195'
const nearbyMap = (page: Page) => page.getByRole('region', { name: /^Map of \d+ stops around you/ })

test('THE-112: Around a chosen place, the map shows you without moving and frames you on a tap', async ({
  page,
  context,
}) => {
  await allowLocation(context)
  await page.goto(AROUND)
  const map = nearbyMap(page)
  await expect(youAreHere(map)).toBeAttached({ timeout: 20_000 })
  expect(await offCentre(map)).toBeGreaterThan(40)
  // The dot comes after the stop markers: an inline position: relative on markers used to push it down by their height
  // (38 px here), so this also checks markers are drawn where they belong.
  await expectLocatesOnTap(map)
})

test('THE-112: location blocked: the Around you map says so', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto(AROUND)
  await expectDeniedOnTap(nearbyMap(page))
})

test.describe('onboarding map picker', () => {
  test.use({ storageState: FIRST_VISIT })
  const picker = (page: Page) => page.getByRole('dialog', { name: 'Set up your favourite stops' })
  const pickerMap = (page: Page) => picker(page).getByRole('region', { name: /^Map of \d+ \w+s in view/ })

  async function openPicker(page: Page) {
    await page.goto('/')
    await expectPrompt(page)
    await prompt(page).getByRole('button', { name: 'Yes' }).click()
    await expect(picker(page)).toBeVisible()
  }

  test('THE-112: located, panned away, a tap frames you again; picks still reach the tray', async ({
    page,
    context,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    // At Cultural Centre, where the fixtures have bus stops to pick.
    await allowLocation(context, { latitude: -27.4732, longitude: 153.0195 })
    await openPicker(page)
    const map = pickerMap(page)
    await expect(youAreHere(map)).toBeVisible({ timeout: 20_000 })
    await panAway(map)
    await expectLocatesOnTap(map)
    // A pick after the (located) remount still goes into the tray.
    await picker(page)
      .getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })
      .click({ timeout: 20_000 })
    await picker(page)
      .getByRole('list', { name: /in view$/ })
      .getByRole('button')
      .first()
      .click()
    await expect(picker(page).locator('[data-tray-items] > li')).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('THE-112: location blocked: the picker map says so', async ({ page, context }) => {
    await context.clearPermissions()
    await openPicker(page)
    await expectDeniedOnTap(pickerMap(page))
  })
})
