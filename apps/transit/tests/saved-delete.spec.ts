/**
 * THE-115: deleting a saved stop from My Transit. Swipe a card left (touch) to show Delete, tap it, or swipe further;
 * from the keyboard, each card's Delete button; with a mouse, the editor's. Every delete is written at once to the
 * stop's own mode store (so the standalone app sees it) and the overlay, and an Undo toast puts back the stop, its
 * place and its name. Runs at each project's size (phone 412 touch, desktop 1280) and at 390×844 touch and 1440×900.
 */
import { type CDPSession, expect, type Page, test } from '@playwright/test'

const FERRY = '/ferry'
const TRAIN = '/train/station/roma-street?to=indooroopilly'
const BUS = '/bus/stop/10802'
const BUS_NAME = 'Cultural Centre station, platform 1'
const BUS_ID = 'bus:10802'
const PREFS_KEY = 'bft-mytransit-prefs'
/** Extra bus stops, so the page is long enough to scroll on a phone. */
const MORE_BUS = ['10795', '1832', '600014', '600029'].map((id) => ({ id, name: `Stop ${id}` }))

async function seed(page: Page, { more = false, overlay = false } = {}) {
  await page.goto('/robots.txt')
  await page.evaluate(
    ({ more, overlay, extra }) => {
      localStorage.setItem(
        'bft-bus-saved',
        JSON.stringify([
          { id: '10802', name: 'Cultural Centre station, platform 1' },
          ...(more ? extra : []),
        ]),
      )
      localStorage.setItem(
        'bft-train-favourites',
        JSON.stringify([{ from: 'roma-street', to: 'indooroopilly' }]),
      )
      localStorage.setItem(
        'brisbane-ferry-selected-stops',
        JSON.stringify({
          outbound: { id: '317584', name: 'Bulimba' },
          inbound: { id: '317590', name: 'Riverside' },
        }),
      )
      if (overlay)
        localStorage.setItem(
          'bft-mytransit-prefs',
          JSON.stringify({
            v: 1,
            order: ['bus:10802', 'ferry:317584>317590', 'train:roma-street>indooroopilly'],
            labels: { 'bus:10802': 'Work' },
          }),
        )
    },
    { more, overlay, extra: MORE_BUS },
  )
  await page.goto('/')
  await expect(page.getByText(`${more ? 3 + MORE_BUS.length : 3} saved · all modes`)).toBeVisible()
  // The rows that can be swiped (loaded after hydration).
  await expect(page.locator('[data-saved-row]').first()).toBeAttached()
  // And the cards' departures in, so no card changes height under a gesture.
  await expect(page.locator('main [data-loading]')).toHaveCount(0)
}

/** The saved cards' links, top to bottom. */
const cardOrder = (page: Page) =>
  page
    .locator('main a')
    .evaluateAll(
      (as, wanted) => as.map((a) => a.getAttribute('href')).filter((h) => h != null && wanted.includes(h)),
      [FERRY, TRAIN, BUS],
    )
const busSaved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]') as { id: string }[])
const row = (page: Page, id: string) => page.locator(`[data-saved-row="${id}"]`)
const toast = (page: Page) => page.locator('[data-saved-toast]')

/** A one-finger drag from the middle of `box` by (dx, dy), in steps, through CDP touch events. */
async function touchDrag(
  cdp: CDPSession,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function swipe(page: Page, id: string, dx: number, dy = 0) {
  const r = row(page, id)
  await r.scrollIntoViewIfNeeded()
  const box = await r.boundingBox()
  if (!box) throw new Error('no box')
  await touchDrag(await page.context().newCDPSession(page), box, dx, dy)
}

async function expectDeletedAfterReload(page: Page, count: number) {
  await page.reload()
  await expect(page.getByText(`${count} saved · all modes`)).toBeVisible()
  await expect(page.locator(`main a[href="${BUS}"]`)).toHaveCount(0)
  expect((await busSaved(page)).map((s) => s.id)).not.toContain('10802')
}

function touchTests() {
  test('swipe left shows Delete; tapping it deletes from bft-bus-saved, with an Undo toast', async ({
    page,
  }) => {
    await seed(page)
    await swipe(page, BUS_ID, -140)
    await expect(row(page, BUS_ID)).toHaveAttribute('data-open', '')
    const del = page.getByRole('button', { name: `Delete ${BUS_NAME}` })
    await expect(del).toBeVisible()
    await del.tap()
    await expect(row(page, BUS_ID)).toHaveCount(0)
    await expect(page.getByText('2 saved · all modes')).toBeVisible()
    await expect(toast(page)).toContainText(`Removed ${BUS_NAME}`)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    // The bus app's own store no longer has it.
    expect(await busSaved(page)).toEqual([])
    // The toast sits above the Mode Tabs, never over them.
    const bar = await toast(page).locator('div').first().boundingBox()
    const nav = await page.getByRole('navigation', { name: 'Modes' }).boundingBox()
    if (!bar || !nav) throw new Error('no boxes')
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y)
    await expectDeletedAfterReload(page, 2)
  })

  test('a long swipe deletes without the tap', async ({ page }) => {
    await seed(page)
    const box = await row(page, BUS_ID).boundingBox()
    await swipe(page, BUS_ID, -(box?.width ?? 400) * 0.8)
    await expect(row(page, BUS_ID)).toHaveCount(0)
    // Focus moves to the row now in its place (here the one before it, as it was last).
    await expect(page.locator(`main a[href="${TRAIN}"]`)).toBeFocused()
    await expect(toast(page)).toContainText(`Removed ${BUS_NAME}`)
    await expectDeletedAfterReload(page, 2)
  })

  test('a short swipe snaps back, and a tap still opens the stop', async ({ page }) => {
    await seed(page)
    await swipe(page, BUS_ID, -30)
    await expect(row(page, BUS_ID)).not.toHaveAttribute('data-open', '')
    await expect(row(page, BUS_ID).locator('> div')).not.toHaveAttribute('style', /translateX/)
    expect(await busSaved(page)).toHaveLength(1)
    await page.locator(`main a[href="${BUS}"]`).tap()
    await expect(page).toHaveURL(new RegExp(`${BUS}$`))
  })

  test('a tap on an open card closes it instead of opening the stop', async ({ page }) => {
    await seed(page)
    await swipe(page, BUS_ID, -140)
    await expect(row(page, BUS_ID)).toHaveAttribute('data-open', '')
    await page.locator(`main a[href="${BUS}"]`).tap()
    await expect(row(page, BUS_ID)).not.toHaveAttribute('data-open', '')
    await expect(page).toHaveURL(/\/$/)
  })

  test('a vertical drag on a card still scrolls the page and never swipes', async ({ page }) => {
    await seed(page, { more: true })
    await page.evaluate(() => window.scrollTo(0, 0))
    const first = page.locator('[data-saved-row]').first()
    const box = await first.boundingBox()
    if (!box) throw new Error('no box')
    await touchDrag(await page.context().newCDPSession(page), box, -6, -220)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50)
    await expect(page.locator('[data-saved-row][data-open]')).toHaveCount(0)
    await expect(page.locator('[data-saved-row] > div[style*="translateX"]')).toHaveCount(0)
  })
}

function sharedTests() {
  test("keyboard: Tab to a card's Delete, press it; focus moves on, Undo puts the stop back and focuses it", async ({
    page,
  }) => {
    await seed(page)
    await page.locator(`main a[href="${TRAIN}"]`).focus()
    await page.keyboard.press('Tab')
    const del = page.getByRole('button', { name: 'Delete Roma Street → Indooroopilly' })
    await expect(del).toBeFocused()
    await expect(del).toBeVisible()
    await page.keyboard.press('Enter')
    await expect.poll(() => cardOrder(page)).toEqual([FERRY, BUS])
    // The next card has focus.
    await expect(page.locator(`main a[href="${BUS}"]`)).toBeFocused()
    await expect(toast(page)).toContainText('Removed Roma Street → Indooroopilly')
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]')),
    ).toEqual([])
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
    await expect(page.locator(`main a[href="${TRAIN}"]`)).toBeFocused()
    await expect(toast(page)).toBeEmpty()
    await page.reload()
    await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
  })

  test("the editor's Delete (mouse), then Undo restores its place in your order and its name", async ({
    page,
  }) => {
    await seed(page, { overlay: true })
    await expect.poll(() => cardOrder(page)).toEqual([BUS, FERRY, TRAIN])
    await page.getByRole('button', { name: 'Edit order and names' }).click()
    await page.getByRole('button', { name: 'Delete Work' }).click()
    await expect(page.locator('[data-saved-edit-row]')).toHaveCount(2)
    await expect(toast(page)).toContainText('Removed Work')
    const prefs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), PREFS_KEY)
    expect(prefs.order).toEqual(['ferry:317584>317590', 'train:roma-street>indooroopilly'])
    expect(prefs.labels).toEqual({})
    expect(await busSaved(page)).toEqual([])
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-saved-edit-row]').first()).toHaveAttribute('data-saved-edit-row', BUS_ID)
    await expect(page.getByRole('textbox', { name: `Name for ${BUS_NAME}` })).toHaveValue('Work')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.reload()
    await expect.poll(() => cardOrder(page)).toEqual([BUS, FERRY, TRAIN])
    await expect(page.locator(`main a[href="${BUS}"]`)).toContainText('Work')
    expect((await busSaved(page)).map((s) => s.id)).toEqual(['10802'])
  })

  test('Undo after a rename made since the delete keeps the item in its place after a reload', async ({
    page,
  }) => {
    await seed(page)
    await page.getByRole('button', { name: 'Edit order and names' }).click()
    await page.getByRole('button', { name: 'Delete Bulimba → Riverside' }).click()
    await page.getByRole('textbox', { name: `Name for ${BUS_NAME}` }).fill('Work')
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
    await page.reload()
    await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
    await expect(page.locator(`main a[href="${BUS}"]`)).toContainText('Work')
  })

  test('deleting every stop shows the empty state; the delete survives a reload', async ({ page }) => {
    await seed(page)
    for (const name of ['Bulimba → Riverside', 'Roma Street → Indooroopilly', BUS_NAME]) {
      await page.getByRole('button', { name: `Delete ${name}` }).focus()
      await page.keyboard.press('Enter')
      await expect(toast(page)).toContainText(`Removed ${name}`)
    }
    await expect(page.getByText('Nothing in My Transit yet')).toBeVisible()
    await expect(page.locator('[data-saved-empty]')).toBeFocused()
    // A second delete replaced the toast; the earlier ones stay done.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => cardOrder(page)).toEqual([BUS])
    await page.reload()
    await expect(page.getByText('1 saved · all modes')).toBeVisible()
    await expect.poll(() => cardOrder(page)).toEqual([BUS])
    expect(await page.evaluate(() => localStorage.getItem('brisbane-ferry-selected-stops'))).toBeNull()
  })

  test('after a focused Undo, the next toast still goes by itself', async ({ page }) => {
    test.slow()
    await seed(page)
    await page.getByRole('button', { name: `Delete ${BUS_NAME}` }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Undo' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => cardOrder(page)).toEqual([FERRY, TRAIN, BUS])
    await page.getByRole('button', { name: 'Delete Roma Street → Indooroopilly' }).focus()
    await page.keyboard.press('Enter')
    await expect(toast(page)).toContainText('Removed Roma Street → Indooroopilly')
    await expect(toast(page)).toBeEmpty({ timeout: 10_000 })
  })

  test('the toast stays while pointed at, then goes', async ({ page }) => {
    test.slow()
    await seed(page)
    await page.getByRole('button', { name: `Delete ${BUS_NAME}` }).focus()
    await page.keyboard.press('Enter')
    // Focus is on the next card now; hold the toast with the pointer instead.
    await page.locator('[data-saved-toast] > div').hover()
    await page.waitForTimeout(8_500)
    await expect(toast(page)).toContainText(`Removed ${BUS_NAME}`)
    await page.mouse.move(5, 5)
    await expect(toast(page)).toBeEmpty({ timeout: 10_000 })
  })
}

/** Runs a describe block's tests in one project only (the extra sizes need not run twice). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

test.describe('at the project size', () => {
  test.describe('touch', () => {
    test.skip(({ hasTouch }) => !hasTouch, 'touch devices only')
    touchTests()
  })
  sharedTests()
})

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  touchTests()
  sharedTests()
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  sharedTests()
})
