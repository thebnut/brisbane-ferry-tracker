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

  const picker = page.getByLabel('Bus stops map', { exact: true })
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
  const picker = page.getByLabel('Bus stops map', { exact: true })
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
  test("a failed geo tile says stops couldn't load, never a broken map", async ({ page }) => {
    await page.route(/\/data\/bus\/geo\//, (r) => r.abort())
    await page.goto('/')
    await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
    const picker = page.getByLabel('Bus stops map', { exact: true })
    await expect(picker.getByRole('status')).toHaveText(/Couldn't load stops/, { timeout: 20_000 })
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
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      ...rest: unknown[]
    ) {
      return /webgl/.test(id) ? null : getContext.call(this, id as '2d', ...(rest as []))
    } as typeof getContext
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
  const picker = page.getByLabel('Bus stops map', { exact: true })
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

test('keyboard: focus moves into the picker, Escape steps back through list, card and map, then returns to the Map button', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByLabel('Bus stops map', { exact: true })
  await expect(picker.getByRole('button', { name: 'Close the stop map' })).toBeFocused()
  const listButton = picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })
  await expect(listButton).toBeVisible({ timeout: 20_000 })
  await listButton.focus()
  await page.keyboard.press('Enter')
  const first = picker.getByRole('list', { name: 'Bus stops in view' }).getByRole('button').first()
  await first.focus()
  // Escape on a stop in the list closes the list and keeps focus in the picker.
  await page.keyboard.press('Escape')
  await expect(listButton).toBeFocused()
  await page.keyboard.press('Enter')
  await first.focus()
  await page.keyboard.press('Enter')
  const card = picker.locator('[data-stop-card]')
  await expect(card).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(listButton).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(toggle).toBeFocused()
})

test('phones: the full-screen picker is a modal dialog; Tab stays inside, the page behind is inert', async ({
  page,
  isMobile,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
  const label = { name: 'Bus stops map' }
  if (!isMobile) {
    // Desktop: beside the list, not modal.
    await expect(page.getByRole('region', label)).toBeVisible()
    await expect(page.getByRole('dialog', label)).toHaveCount(0)
    return
  }
  const picker = page.getByRole('dialog', label)
  await expect(picker).toHaveAttribute('aria-modal', 'true')
  await expect(page.locator('#stop-search')).not.toBeFocused()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab')
    expect(await picker.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  // The page is usable again once it closes.
  expect(await page.locator('[inert]').count()).toBe(0)
  await page.locator('#stop-search').fill('cultural')
  await expect(page.getByRole('list', { name: 'Matching stops' }).locator('visible=true')).toContainText(
    'Cultural',
  )
})

test.describe(() => {
  // Requests go straight to the network here, so page.route can slow one down.
  test.use({ serviceWorkers: 'block' })
  test("a slow card answer for the previous stop is cancelled, never shown on the next stop's card", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
    const slow: string[] = []
    let slowId = ''
    await page.route(/\/v1\/bus\/stops\/[^/]+\/departures\?limit=3$/, async (r) => {
      if (!slowId) slowId = /stops\/([^/]+)\//.exec(r.request().url())?.[1] ?? ''
      if (r.request().url().includes(`/stops/${slowId}/`)) {
        slow.push(r.request().url())
        await new Promise((ok) => setTimeout(ok, 3_000))
      }
      await r.continue().catch(() => {})
    })
    // What the page did with each card request, recorded in the page itself: Playwright's requestfailed event is not
    // reliable for a request still held in a page.route handler when the page aborts it (1 in 12 missed, R13 flake).
    await page.addInitScript(() => {
      const log: Array<{ url: string; outcome: string }> = []
      ;(window as unknown as { __cardFetches: typeof log }).__cardFetches = log
      const realFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = String(input instanceof Request ? input.url : input)
        if (!/departures\?limit=3$/.test(url)) return realFetch(input, init)
        const entry = { url, outcome: 'pending' }
        log.push(entry)
        init?.signal?.addEventListener('abort', () => {
          if (entry.outcome === 'pending') entry.outcome = 'aborted'
        })
        return realFetch(input, init).then(
          (res) => {
            if (entry.outcome === 'pending') entry.outcome = 'completed'
            return res
          },
          (error) => {
            if (entry.outcome === 'pending') entry.outcome = init?.signal?.aborted ? 'aborted' : 'failed'
            throw error
          },
        )
      }
    })
    const requestFailed: string[] = []
    page.on('requestfailed', (r) => {
      if (/departures\?limit=3$/.test(r.url())) requestFailed.push(r.url())
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
    const picker = page.getByLabel('Bus stops map', { exact: true })
    const listButton = picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })
    const stops = picker
      .getByRole('list', { name: 'Bus stops in view' })
      .getByRole('button', { name: /Cultural Centre/ })
    await listButton.click({ timeout: 20_000 })
    await stops.nth(0).click()
    await expect(picker.getByText('Loading departures…')).toBeVisible()
    await listButton.click()
    await stops.nth(1).click()
    const card = picker.locator('[data-stop-card]')
    const second = (await card.getAttribute('data-stop-card')) as string
    expect(second).not.toBe(slowId)
    await expect(card.getByRole('listitem').first()).toBeVisible({ timeout: 10_000 })
    const rowsBefore = await card.getByRole('list').textContent()
    await page.waitForTimeout(3_500)
    await expect(card).toHaveAttribute('data-stop-card', second)
    expect(await card.getByRole('list').textContent()).toBe(rowsBefore)
    expect(slow).toHaveLength(1)
    // The previous stop's request was aborted by the page (its signal fired before any answer), and only the current
    // stop's request completed.
    const fetches = await page.evaluate(
      () => (window as unknown as { __cardFetches: Array<{ url: string; outcome: string }> }).__cardFetches,
    )
    expect(fetches.filter((f) => f.url.includes(`/stops/${slowId}/`)).map((f) => f.outcome)).toEqual([
      'aborted',
    ])
    expect(fetches.filter((f) => f.url.includes(`/stops/${second}/`)).map((f) => f.outcome)).toEqual([
      'completed',
    ])
    test.info().annotations.push({
      type: 'requestfailed seen for the aborted request',
      description: String(requestFailed.some((u) => u.includes(`/stops/${slowId}/`))),
    })
  })

  test('a search chunk that cannot load is an error, not an endless "Loading stops…"', async ({
    page,
    isMobile,
  }) => {
    await page.route(/\/assets\/search-[\w-]+\.js$/, (r) => r.abort())
    await page.goto('/')
    await page.locator(isMobile ? '#stop-search' : '#stop-search-desktop').fill('cultural')
    await expect(
      page.getByRole('status').filter({ hasText: "Couldn't load the stop list" }).locator('visible=true'),
    ).toBeVisible({
      timeout: 15_000,
    })
  })
})
