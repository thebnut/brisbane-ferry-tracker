/**
 * P3: the map stop picker beside the stop search. Map button → the picker (full screen on phones, beside the list on
 * desktop) → a stop from the keyboard list or a tap on the map → its card (next departures, loaded only then) → Save
 * puts it in My stops, Open goes to the stop page; the next search has the Map button highlighted. `BASE` is "" here;
 * the transit app runs the same flow under /bus (apps/transit/tests/map-picker.spec.ts).
 */
import { expect, test } from '@playwright/test'

const CARD_DEPARTURES = /\/v1\/bus\/stops\/[^/]+\/departures\?limit=3$/

test('Map → a stop → its card → Save → Open; the Map button is remembered', async ({
  page,
  context,
  isMobile,
}) => {
  // Location already allowed: the picker centres on it (Cultural Centre, which has fixture departures).
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const cardCalls: string[] = []
  page.on('request', (r) => {
    if (CARD_DEPARTURES.test(r.url())) cardCalls.push(r.url())
  })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true')
  // First visit: the list is the default and the button isn't highlighted.
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAttribute('data-map-toggle', '')
  // Desktop: the map sits beside the search results.
  if (!isMobile) await page.locator('#stop-search-desktop').fill('cultural centre')
  await toggle.click()

  const picker = page.getByRole('region', { name: 'Bus stops map' })
  await expect(picker).toBeVisible()
  const box = await picker.boundingBox()
  const viewport = page.viewportSize()
  if (isMobile) expect(box?.height).toBeGreaterThan((viewport?.height ?? 0) * 0.9)
  else {
    const results = await page
      .getByRole('list', { name: 'Matching stops' })
      .locator('visible=true')
      .boundingBox()
    expect(results && box && results.x + results.width <= box.x).toBe(true)
  }

  await expect(picker.getByRole('button', { name: 'You are here' })).toHaveCount(0)
  await expect(picker.getByLabel('You are here')).toBeVisible({ timeout: 20_000 })
  // The keyboard path: the stops in view, as buttons, nearest the centre first.
  const list = picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })
  await expect(list).toBeVisible({ timeout: 20_000 })
  expect(cardCalls).toEqual([])
  await list.click()
  const first = picker
    .getByRole('list', { name: 'Bus stops in view' })
    .getByRole('button', { name: /Cultural Centre/ })
    .first()
  const name = ((await first.locator('span').first().textContent()) ?? '').trim()
  await first.click()

  const card = picker.getByRole('dialog', { name })
  await expect(card).toBeVisible()
  await expect(card.getByText('Loading departures…')).toHaveCount(0, { timeout: 10_000 })
  await expect(card.getByText('Departures unavailable right now.')).toHaveCount(0)
  // A stop with no service soon says so; otherwise up to three rows.
  const rows = card.getByRole('list', { name: `Next departures from ${name}` }).getByRole('listitem')
  expect(await rows.count()).toBeLessThanOrEqual(3)
  expect(cardCalls).toHaveLength(1)

  const save = card.getByRole('button', { name: 'Save' })
  await save.click()
  await expect(card.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true')
  const id = (await card.getAttribute('data-stop-card')) as string
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]'))
  expect(saved).toContainEqual({ id, name })

  await card.getByRole('link', { name: 'Open' }).click()
  await expect(page).toHaveURL(new RegExp(`/stop/${id}$`))
  await expect(page.getByTestId('departure').first()).toBeVisible()

  // The next search: the map is one tap away and highlighted (after hydration), the list still the default view.
  await page.goto('/')
  await expect(toggle).toHaveAttribute('data-map-toggle', 'remembered')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(picker).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a tap on a stop pin opens its card; Escape and Close step back; closing forgets the map', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
  const picker = page.getByRole('region', { name: 'Bus stops map' })
  await picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  await picker.getByRole('list', { name: 'Bus stops in view' }).getByRole('button').first().click()
  const card = picker.locator('[data-stop-card]')
  const id = await card.getAttribute('data-stop-card')
  // The list choice centres the map on the stop (zoom 16, no clusters); close the card, then tap the pin there.
  await card.getByRole('button', { name: /^Close / }).click()
  await expect(card).toHaveCount(0)
  const canvas = picker.locator('canvas')
  await expect(async () => {
    const b = await canvas.boundingBox()
    if (!b) throw new Error('no canvas')
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await expect(picker.locator(`[data-stop-card="${id}"]`)).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await picker.getByRole('button', { name: 'Close the stop map' }).click()
  await expect(picker).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('bft-stop-picker-map'))).toBeNull()
})

test.describe(() => {
  // The service worker would answer the tile requests before page.route sees them.
  test.use({ serviceWorkers: 'block' })
  test('a failed geo tile says map data is unavailable, never a broken map', async ({ page }) => {
    await page.route(/\/data\/bus\/geo\//, (r) => r.abort())
    await page.goto('/')
    await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
    const picker = page.getByRole('region', { name: 'Bus stops map' })
    await expect(picker.getByRole('status')).toHaveText(/Map data unavailable/, { timeout: 20_000 })
    await expect(picker.locator('canvas')).toBeVisible()
  })
})

test('without WebGL the picker says the map is unavailable and the search keeps working (R13-R1)', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      return /webgl/.test(id) ? null : getContext.call(this, id as '2d', ...(rest as []))
    } as typeof getContext
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
  const picker = page.getByRole('region', { name: 'Bus stops map' })
  await expect(picker.getByRole('status')).toContainText('Map unavailable on this device')
  await picker.getByRole('button', { name: 'Close the stop map' }).click()
  await expect(picker).toHaveCount(0)
  const field = page.locator('#stop-search, #stop-search-desktop').locator('visible=true')
  await field.fill('cultural centre')
  await expect(page.getByRole('list', { name: 'Matching stops' }).locator('visible=true')).toContainText(
    'Cultural Centre',
  )
  expect(errors).toEqual([])
})
