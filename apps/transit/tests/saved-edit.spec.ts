/**
 * THE-114: My Transit's own order and names for saved stops, kept on the device (bft-mytransit-prefs) over each mode's
 * own store. Drag with a mouse (desktop) or a finger (phone), move from the keyboard, rename and reset; every change
 * survives a reload, and a device with saves from before the change sees its list exactly as it was.
 */
import { expect, type Page, test } from '@playwright/test'

/** The ferry favourite's card opens its trip's boards (THE-118). */
const FERRY = '/ferry?from=317584&to=317590'
const TRAIN = '/train/station/roma-street?to=indooroopilly'
const BUS = '/bus/stop/10802'
const BUS_NAME = 'Cultural Centre station, platform 1'
const PREFS_KEY = 'bft-mytransit-prefs'

/** Saves one item per mode in each app's own store, once (a reload keeps what the page did with them). */
async function seed(page: Page) {
  await page.goto('/robots.txt')
  await page.evaluate(() => {
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    )
    localStorage.setItem(
      'bft-train-favourites',
      JSON.stringify([{ from: 'roma-street', to: 'indooroopilly' }]),
    )
    // A remembered pair: it becomes the ferry favourite (THE-118).
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })
  await page.goto('/')
  await expect(page.getByText('3 saved · all modes')).toBeVisible()
}

/** The saved cards' links, top to bottom. */
const cardOrder = (page: Page) =>
  page
    .locator('main a')
    .evaluateAll(
      (as, wanted) => as.map((a) => a.getAttribute('href')).filter((h) => h != null && wanted.includes(h)),
      ['/ferry', '/train/station/roma-street?to=indooroopilly', '/bus/stop/10802'],
    )

const rowOrder = (page: Page) =>
  page
    .locator('[data-saved-edit-row]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-saved-edit-row')))

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Edit order and names' }).click()
  // Focus moves into the editor (the button that opened it is gone).
  await expect(page.getByRole('heading', { name: 'Edit My Transit' })).toBeFocused()
}

async function expectOrderAfterReload(page: Page, order: string[]) {
  await expect.poll(() => cardOrder(page)).toEqual(order)
  await page.reload()
  await expect(page.getByText('3 saved · all modes')).toBeVisible()
  await expect.poll(() => cardOrder(page)).toEqual(order)
}

const status = (page: Page) => page.locator('[data-saved-edit-status]')

test('a device with saves from before the change sees them unchanged, and nothing is written', async ({
  page,
}) => {
  await seed(page)
  await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
  await expect(page.getByRole('link', { name: /Ferry.*Bulimba → Riverside/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Train.*Roma Street → Indooroopilly/ })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`Bus.*${BUS_NAME}`) })).toBeVisible()
  await page.reload()
  await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
  expect(await page.evaluate((k) => localStorage.getItem(k), PREFS_KEY)).toBeNull()
})

test('drag to reorder with the mouse', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse drag on desktop; the phone drags by touch')
  await seed(page)
  await openEditor(page)
  const handle = page.getByRole('button', { name: `Reorder ${BUS_NAME}` })
  const from = await handle.boundingBox()
  const top = await page.locator('[data-saved-edit-row]').first().boundingBox()
  if (!from || !top) throw new Error('no boxes')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, top.y + 4, { steps: 12 })
  await expect(page.locator('[data-saved-edit-row]').first()).toHaveAttribute('data-grabbed', '')
  await page.mouse.up()
  await expect
    .poll(() => rowOrder(page))
    .toEqual(['bus:10802', 'ferry:317584>317590', 'train:roma-street>indooroopilly'])
  await expect(status(page)).toContainText('dropped at position 1 of 3')
  await page.getByRole('button', { name: 'Done' }).click()
  await expectOrderAfterReload(page, [BUS, FERRY, TRAIN])
})

test('drag to reorder by touch, without scrolling the page', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch drag on the phone')
  await seed(page)
  await openEditor(page)
  const handle = page.getByRole('button', { name: 'Reorder Bulimba → Riverside' })
  await handle.scrollIntoViewIfNeeded()
  const from = await handle.boundingBox()
  const last = await page.locator('[data-saved-edit-row]').last().boundingBox()
  if (!from || !last) throw new Error('no boxes')
  const scrollBefore = await page.evaluate(() => window.scrollY)
  const cdp = await page.context().newCDPSession(page)
  const x = from.x + from.width / 2
  const y0 = from.y + from.height / 2
  const y1 = last.y + last.height - 4
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  for (let i = 1; i <= 12; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12 }],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(() => rowOrder(page))
    .toEqual(['train:roma-street>indooroopilly', 'bus:10802', 'ferry:317584>317590'])
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  await page.getByRole('button', { name: 'Done' }).click()
  await expectOrderAfterReload(page, [TRAIN, BUS, FERRY])
})

test('reorder from the keyboard: pick up, move, drop, and Escape cancels', async ({ page }) => {
  await seed(page)
  await openEditor(page)
  const handle = page.getByRole('button', { name: 'Reorder Roma Street → Indooroopilly' })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(status(page)).toContainText('picked up, position 2 of 3')
  await page.keyboard.press('ArrowDown')
  await expect(status(page)).toContainText('moved to position 3 of 3')
  // Focus stays on the moved item's handle.
  await expect(handle).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(status(page)).toContainText('Move cancelled')
  await expect
    .poll(() => rowOrder(page))
    .toEqual(['ferry:317584>317590', 'train:roma-street>indooroopilly', 'bus:10802'])

  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await expect(handle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('dropped at position 1 of 3')
  // Leaving a held item drops it where it is, and focus is never pulled back.
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: `Name for ${BUS_NAME}` }).click()
  await page.keyboard.type('W')
  await expect(page.getByRole('textbox', { name: `Name for ${BUS_NAME}` })).toBeFocused()
  await page.getByRole('button', { name: `Reset name for ${BUS_NAME}` }).click()
  // The Move up button moves one place in one tap.
  await page.getByRole('button', { name: `Move ${BUS_NAME} up` }).click()
  await expect
    .poll(() => rowOrder(page))
    .toEqual(['train:roma-street>indooroopilly', 'bus:10802', 'ferry:317584>317590'])
  await page.getByRole('button', { name: 'Done' }).click()
  // Closing gives focus back to the button that opened the editor.
  await expect(page.getByRole('button', { name: 'Edit order and names' })).toBeFocused()
  await expectOrderAfterReload(page, [TRAIN, BUS, FERRY])
})

test('Move up/down from the keyboard keeps focus on the item, even at the top or bottom', async ({
  page,
}) => {
  await seed(page)
  await openEditor(page)
  const TRAIN_NAME = 'Roma Street → Indooroopilly'
  // Tab from the 2nd item's handle to its Move up, then Enter: it reaches the top, so Move up is disabled.
  await page.getByRole('button', { name: `Reorder ${TRAIN_NAME}` }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: `Move ${TRAIN_NAME} up` })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('moved to position 1 of 3')
  await expect(page.getByRole('button', { name: `Move ${TRAIN_NAME} down` })).toBeFocused()
  // Down twice to the bottom: the first press keeps focus on Move down, the second lands on Move up.
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('moved to position 2 of 3')
  await expect(page.getByRole('button', { name: `Move ${TRAIN_NAME} down` })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('moved to position 3 of 3')
  await expect(page.getByRole('button', { name: `Move ${TRAIN_NAME} up` })).toBeFocused()
  await expect
    .poll(() => rowOrder(page))
    .toEqual(['ferry:317584>317590', 'bus:10802', 'train:roma-street>indooroopilly'])
})

test('rename a saved stop, then reset it to its own name', async ({ page }) => {
  await seed(page)
  await openEditor(page)
  const input = page.getByRole('textbox', { name: `Name for ${BUS_NAME}` })
  await expect(input).toHaveAttribute('placeholder', BUS_NAME)
  await input.fill('  <b>Work</b>  ')
  await page.getByRole('button', { name: 'Done' }).click()
  const card = page.locator(`main a[href="${BUS}"]`)
  // Plain text, trimmed; the original stays under it so the stop is recognisable.
  await expect(card).toContainText('<b>Work</b>')
  await expect(card.locator('b')).toHaveCount(0)
  await expect(card).toContainText(BUS_NAME)
  await page.reload()
  await expect(card).toContainText('<b>Work</b>')

  await openEditor(page)
  await expect(input).toHaveValue('<b>Work</b>')
  await page.getByRole('button', { name: `Reset name for ${BUS_NAME}` }).click()
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(card).not.toContainText('Work')
  await page.reload()
  await expect(page.getByText('3 saved · all modes')).toBeVisible()
  await expect(card).not.toContainText('Work')
  await expect(page.getByRole('link', { name: new RegExp(`Bus.*${BUS_NAME}`) })).toBeVisible()
})

test('a name is capped at 40 characters', async ({ page }) => {
  await seed(page)
  await openEditor(page)
  const input = page.getByRole('textbox', { name: 'Name for Bulimba → Riverside' })
  await input.fill('x'.repeat(60))
  await expect(input).toHaveValue('x'.repeat(40))
  await page.getByRole('button', { name: 'Done' }).click()
  await page.reload()
  await expect(page.locator(`main a[href="${FERRY}"]`)).toContainText('x'.repeat(40))
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), PREFS_KEY)
  expect(stored.labels['ferry:317584>317590']).toBe('x'.repeat(40))
})
