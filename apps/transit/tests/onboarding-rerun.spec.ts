/**
 * THE-113: "Set up My Transit stops" in Settings re-opens the onboarding picker whenever wanted, with every mode's
 * saved stops already in the tray. In BrisbaneTransit every Settings has it (My Transit's, and each mode tab's own,
 * which opens this app's picker with all three modes); one Save makes each mode's store match the tray; Cancel
 * changes nothing; the first-visit prompt never comes back.
 */
import {
  cancelRerun,
  expectNoPrompt,
  expectPrompt,
  FIRST_VISIT,
  openRerun,
  prompt,
  rerunPicker,
  rerunTray,
  rerunTrayNames,
} from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const stores = (page: Page) =>
  page.evaluate(() => ({
    bus: JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]') as { id: string; name: string }[],
    train: JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'),
    ferry: JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? 'null'),
  }))

async function add(tray: ReturnType<typeof rerunTray>, label: string, query: string, name: RegExp) {
  await tray.getByLabel(label).fill(query)
  await tray
    .getByRole('list', { name: /matching/ })
    .getByRole('button', { name })
    .first()
    .click({ timeout: 20_000 })
}

test('fresh device: onboarding, then the Bus tab’s Settings re-runs it for every mode; add one, remove one, Save', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  const first = page.getByRole('dialog', { name: 'Set up your favourite stops' })
  await add(first.getByRole('complementary'), 'Find a stop by name', 'cultural centre', /Cultural Centre/)
  await first.getByRole('button', { name: 'Train', exact: true }).click()
  await add(first.getByRole('complementary'), 'Find a station by name', 'central', /^Central/)
  await first.getByRole('button', { name: /^Save/ }).click()
  await expect(page).toHaveURL(/\/$/)
  const [cultural] = (await stores(page)).bus
  expect(cultural).toBeTruthy()

  // The bus app's own Settings, inside BrisbaneTransit: the picker has every mode, and opens on Bus.
  await page.goto('/bus')
  await openRerun(page)
  await expect(rerunPicker(page).getByRole('button', { name: 'Bus', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(rerunTrayNames(page)).toHaveText(['Central', cultural?.name ?? ''])
  await rerunPicker(page).getByRole('button', { name: 'Train', exact: true }).click()
  await add(rerunTray(page), 'Find a station by name', 'roma', /^Roma Street/)
  await rerunTray(page)
    .getByRole('button', { name: `Remove ${cultural?.name}` })
    .click()
  await rerunTray(page).getByRole('button', { name: 'Save 2 stops' }).click()
  await expect(page).toHaveURL(/\/$/)
  const after = await stores(page)
  expect(after.bus).toEqual([])
  expect(after.train).toEqual([
    { from: 'central', to: null },
    { from: 'roma-street', to: null },
  ])
  expect(after.ferry).toBeNull()
  await expect(page.locator('main a[href="/train/station/roma-street"]').first()).toBeVisible({
    timeout: 15_000,
  })
  await page.reload()
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('My Transit’s Settings and the Ferry tab’s: Cancel changes nothing; the prompt never comes back', async ({
  page,
}) => {
  const seeded = {
    bus: [{ id: '10802', name: 'Cultural Centre' }],
    train: [{ from: 'central', to: null }],
    ferry: { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } },
  }
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('bft-onboarding', '1')
    localStorage.setItem('bft-bus-saved', JSON.stringify(s.bus))
    localStorage.setItem('bft-train-favourites', JSON.stringify(s.train))
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(s.ferry))
  }, seeded)
  await page.goto('/')
  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['From Bulimba', 'Central', 'Cultural Centre'])
  await rerunTray(page).getByRole('button', { name: 'Remove Central' }).click()
  await cancelRerun(page)
  expect(await stores(page)).toEqual(seeded)

  // The Ferry tab's Settings is its stop selector: the entry is there too, and opens on Ferry.
  await page.goto('/ferry')
  await openRerun(page)
  await expect(rerunPicker(page).getByRole('button', { name: 'Ferry', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await rerunTray(page).getByRole('button', { name: 'Remove Bulimba' }).click()
  await cancelRerun(page)
  expect(await stores(page)).toEqual(seeded)
  await page.reload()
  await expectNoPrompt(page)
})

/** Saves in every mode's store (one train favourite is a trip, which the tray never shows), plus My Transit's overlay. */
async function seedSaves(page: Page, prefs: unknown) {
  await page.addInitScript((overlay) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('bft-onboarding', '1')
    localStorage.setItem('bft-bus-saved', JSON.stringify([{ id: '10802', name: 'Cultural Centre' }]))
    localStorage.setItem(
      'bft-train-favourites',
      JSON.stringify([
        { from: 'central', to: null },
        { from: 'roma-street', to: 'indooroopilly' },
      ]),
    )
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
    if (overlay) localStorage.setItem('bft-mytransit-prefs', JSON.stringify(overlay))
  }, prefs)
}

const FERRY = '/ferry'
const TRIP = '/train/station/roma-street?to=indooroopilly'
const CENTRAL = '/train/station/central'
const BUS = '/bus/stop/10802'
/** My Transit's cards, top to bottom. */
const cardOrder = (page: Page) =>
  page
    .locator('main a')
    .evaluateAll(
      (as, wanted) => as.map((a) => a.getAttribute('href')).filter((h) => h != null && wanted.includes(h)),
      [FERRY, TRIP, CENTRAL, BUS],
    )

/** Re-run from My Transit's Settings, move Cultural Centre up one (above Central) and Save. */
async function rerunMovingBusUp(page: Page) {
  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['From Bulimba', 'Central', 'Cultural Centre'])
  await rerunTray(page).getByRole('button', { name: 'Move Cultural Centre up' }).click()
  await expect(rerunTrayNames(page)).toHaveText(['From Bulimba', 'Cultural Centre', 'Central'])
  // Save reloads My Transit (already at /): wait for that load, not just the URL.
  const reloaded = page.waitForEvent('framenavigated', (f) => f === page.mainFrame())
  await rerunTray(page).getByRole('button', { name: 'Save 3 stops' }).click()
  await reloaded
  await page.waitForLoadState()
  await expect(rerunPicker(page)).toHaveCount(0)
}

test('THE-114: with My Transit’s own order, a re-run’s tray order becomes it; the trip keeps its place and names stay', async ({
  page,
}) => {
  await seedSaves(page, {
    v: 1,
    order: ['bus:10802', 'train:roma-street>indooroopilly', 'ferry:317584>317590', 'train:central>'],
    labels: { 'bus:10802': 'Work', 'train:roma-street>indooroopilly': 'Uni' },
  })
  await page.goto('/')
  await expect.poll(() => cardOrder(page)).toEqual([BUS, TRIP, FERRY, CENTRAL])
  await rerunMovingBusUp(page)
  // The tray's items (ferry, bus, Central) fill their places in the tray's order; the trip stays second.
  await expect.poll(() => cardOrder(page), { timeout: 15_000 }).toEqual([FERRY, TRIP, BUS, CENTRAL])
  await expect(page.locator(`main a[href="${BUS}"]`)).toContainText('Work')
  await expect(page.locator(`main a[href="${TRIP}"]`)).toContainText('Uni')
  await page.reload()
  await expect.poll(() => cardOrder(page), { timeout: 15_000 }).toEqual([FERRY, TRIP, BUS, CENTRAL])
})

test('THE-114: with no order of its own, a re-run writes none', async ({ page }) => {
  await seedSaves(page, null)
  await page.goto('/')
  await expect.poll(() => cardOrder(page)).toEqual([FERRY, CENTRAL, TRIP, BUS])
  await rerunMovingBusUp(page)
  await expect.poll(() => cardOrder(page), { timeout: 15_000 }).toEqual([FERRY, CENTRAL, TRIP, BUS])
  expect(await page.evaluate(() => localStorage.getItem('bft-mytransit-prefs'))).toBeNull()
})
