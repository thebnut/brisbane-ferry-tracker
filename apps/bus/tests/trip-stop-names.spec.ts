/**
 * Trip view stop names (Brett, 19 Oct: route 232 showed "Stop 142 / Stop 000142"). The API now names trip stops from
 * the stop index; the page shows those names, and a stop the API can't name shows its stop number once.
 */
import { expect, test } from '@playwright/test'

const openTrip = async (page: import('@playwright/test').Page) => {
  await page.goto('/stop/10802')
  await page.getByTestId('departure').first().locator('a').click()
  const stops = page.getByRole('list', { name: 'Stops on your trip' })
  await expect(stops).toBeVisible()
  // Every stop: "Your trip" starts at your stop, with the ones before it collapsed (THE-118 PR 6).
  const earlier = page.locator('[data-collapsed=earlier]')
  if (await earlier.count()) await earlier.click()
  return stops.locator(':scope > li[data-kind]')
}

test('every stop on a trip shows its real name from the trip API', async ({ page }) => {
  const stops = await openTrip(page)
  const key = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() as string)
  const res = await page.request.get(`/__fixtures/v1/bus/trips/${encodeURIComponent(key)}`)
  expect(res.ok()).toBe(true)
  const body: { stops: Array<{ stopId: string; name?: string }> } = await res.json()
  expect(body.stops.length).toBeGreaterThan(1)
  for (const s of body.stops) expect(s.name, `trip API name for ${s.stopId}`).toBeTruthy()
  const shown = (await stops.allInnerTexts()).map((t) => t.split('\n')[0]?.trim())
  expect(shown).toEqual(body.stops.map((s) => s.name))
  for (const n of shown) expect(n).not.toMatch(/^Stop \d+$/)
})

test('a stop the API leaves unnamed shows its stop number once, not "Stop 142 · Stop 000142"', async ({
  page,
  context,
}) => {
  const stops = await openTrip(page)
  // From now on the trip API names no stops (as before the fix); refresh to take that response.
  await context.route('**/__fixtures/v1/bus/trips/**', async (route) => {
    const res = await route.fetch()
    const body: { stops: Array<{ name?: string }> } = await res.json()
    for (const s of body.stops) delete s.name
    await route.fulfill({ response: res, json: body })
  })
  await page.getByRole('button', { name: 'Refresh' }).click()
  const first = stops.first()
  await expect(first).toContainText(/^Stop \d{6}/)
  for (const text of await stops.allInnerTexts()) {
    const [name = '', meta = ''] = text.split('\n').map((t) => t.trim())
    expect(name).toMatch(/^Stop \d{6}$/)
    // The stop number is the name, so the meta line doesn't repeat it.
    expect(meta).not.toContain(name)
  }
})
