/**
 * P3: the map station picker on the station search (/stations). Map → a station from the keyboard list → its card
 * (next trains) → Save makes it a favourite (no destination) → Open goes to the station board; the next search has
 * the Map button highlighted. The transit app runs the same flow under /train (apps/transit/tests/map-picker.spec.ts).
 */
import { expect, test } from '@playwright/test'

test('Map → a station → its card → Save → Open; the Map button is remembered', async ({ page, isMobile }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/stations')
  const toggle = page.getByRole('button', { name: 'Show stations on a map' })
  await expect(toggle).toHaveAttribute('data-map-toggle', '')
  await toggle.click()
  const picker = page.getByLabel('Train stations map', { exact: true })
  await expect(picker).toBeVisible()
  const box = await picker.boundingBox()
  const viewport = page.viewportSize()
  if (isMobile) {
    expect(box?.height).toBeGreaterThan((viewport?.height ?? 0) * 0.9)
    await expect(picker).toHaveAttribute('aria-modal', 'true')
  } else {
    // Desktop: beside the station list, not over it, and not modal.
    await expect(picker).not.toHaveAttribute('aria-modal', 'true')
    const heading = await page.getByRole('heading', { name: 'Choose your trip' }).boundingBox()
    expect(heading && box && heading.x + heading.width <= box.x).toBe(true)
  }
  await picker.getByRole('button', { name: /Stations in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  await picker
    .getByRole('list', { name: 'Train stations in view' })
    .getByRole('button', { name: /^Central/ })
    .click()
  const card = picker.getByRole('dialog', { name: 'Central' })
  await expect(card).toBeFocused()
  await expect(card.getByText(/^Platforms? /)).toBeVisible()
  await expect(
    card.getByRole('list', { name: 'Next departures from Central' }).getByRole('listitem'),
  ).toHaveCount(3, {
    timeout: 10_000,
  })
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(card.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true')
  const favs = await page.evaluate(() => JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'))
  expect(favs).toContainEqual({ from: 'central', to: null })
  await card.getByRole('link', { name: 'Open' }).click()
  await expect(page).toHaveURL(/\/station\/central$/)

  await page.goto('/stations')
  await expect(toggle).toHaveAttribute('data-map-toggle', 'remembered')
  await expect(picker).toHaveCount(0)
  expect(errors).toEqual([])
})

test('favourites saved on either side of the 768 px breakpoint are all kept; a tablet map is usable', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'resizes a desktop window')
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/stations')
  await page.getByRole('button', { name: 'Show stations on a map' }).click()
  const picker = page.getByLabel('Train stations map', { exact: true })
  // Tablet: search and map share the width.
  expect((await picker.boundingBox())?.width).toBeGreaterThan(300)
  const save = async (name: RegExp, card: string) => {
    await picker.getByRole('button', { name: /Stations in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
    await picker
      .getByRole('list', { name: 'Train stations in view' })
      .getByRole('button', { name })
      .first()
      .click()
    await picker.getByRole('dialog', { name: card }).getByRole('button', { name: 'Save' }).click()
    await expect(
      picker.getByRole('dialog', { name: card }).getByRole('button', { name: 'Saved' }),
    ).toBeVisible()
  }
  await save(/^Central/, 'Central')
  // The card and its controls sit inside the tablet panel (none clipped by its overflow).
  const panel = (await picker.boundingBox()) as { x: number; width: number }
  for (const el of [
    picker.getByRole('dialog', { name: 'Central' }),
    picker.getByRole('button', { name: 'Close Central' }),
  ]) {
    const b = (await el.boundingBox()) as { x: number; width: number }
    expect(b.x).toBeGreaterThanOrEqual(panel.x)
    expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width)
  }
  // Across the breakpoint: the phone layout's picker takes over.
  await page.setViewportSize({ width: 500, height: 900 })
  await expect(picker).toHaveAttribute('aria-modal', 'true')
  await save(/^Roma Street/, 'Roma Street')
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(picker).not.toHaveAttribute('aria-modal', 'true')
  await save(/^Fortitude Valley/, 'Fortitude Valley')
  const favs = await page.evaluate(() => JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'))
  for (const from of ['central', 'roma-street', 'fortitude-valley'])
    expect(favs).toContainEqual({ from, to: null })
})
