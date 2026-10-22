/**
 * THE-118 PR 1: one star on every mode's board. Tap Save → "{Name} saved to My Transit · Undo" → the card is on My
 * Transit → Delete it there (Undo puts it back) → gone, and a reload keeps each state. A train board with no
 * destination also offers "Pick a destination", which opens the Going-to sheet. Runs at 390×844 touch, 1280×900 and
 * 1440×900 (each once).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

const BOARDS = {
  ferry: {
    path: '/ferry',
    name: 'Bulimba → Riverside',
    card: '/ferry?from=317584&to=317590',
    store: 'bft-ferry-favourites',
    entry: { from: '317584', to: '317590' },
  },
  train: {
    path: '/train/station/roma-street?to=indooroopilly',
    name: 'Roma Street → Indooroopilly',
    card: '/train/station/roma-street?to=indooroopilly',
    store: 'bft-train-favourites',
    entry: { from: 'roma-street', to: 'indooroopilly' },
  },
  bus: {
    path: '/bus/stop/10802',
    name: 'Cultural Centre station, platform 1',
    card: '/bus/stop/10802',
    store: 'bft-bus-saved',
    entry: { id: '10802', name: 'Cultural Centre station, platform 1' },
  },
} as const

const star = (page: Page, name: string) =>
  page.getByRole('button', {
    name: new RegExp(`^Saved? ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to My Transit$`),
  })
const saveToast = (page: Page) => page.locator('[data-save-toast]')
const stored = (page: Page, key: string) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[], key)

async function axeOnStar(page: Page) {
  const { violations } = await new AxeBuilder({ page }).include('[data-star]').analyze()
  expect(violations).toEqual([])
}

function modeTests() {
  for (const [mode, b] of Object.entries(BOARDS)) {
    test(`${mode}: Save → My Transit card → Delete, Undo, Delete → gone; reloads keep it`, async ({
      page,
    }) => {
      await page.goto(b.path)
      const s = star(page, b.name)
      await expect(s).toHaveAttribute('aria-pressed', 'false')
      await expect(s).toContainText('Save')
      // Hydrated (the ferry star is its own chunk): the button answers.
      await expect(async () => {
        await s.click()
        await expect(s).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
      }).toPass()
      await expect(s).toContainText('Saved')
      await expect(saveToast(page)).toContainText(`${b.name} saved to My Transit`)
      await expect(saveToast(page).getByRole('button', { name: 'Pick a destination' })).toHaveCount(0)
      expect(await stored(page, b.store)).toEqual([b.entry])
      await axeOnStar(page)

      await page.reload()
      await expect(star(page, b.name)).toHaveAttribute('aria-pressed', 'true')

      await page.goto('/')
      const card = page.locator(`main a[href="${b.card}"]`)
      await expect(card).toBeVisible()
      await expect(page.locator('[data-saved-row]').first()).toBeAttached()
      await card.focus()
      await page.keyboard.press('Tab')
      const del = page.getByRole('button', { name: `Delete ${b.name}` })
      await expect(del).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(card).toHaveCount(0)
      await page.getByRole('button', { name: 'Undo' }).click()
      await expect(card).toBeVisible()
      expect(await stored(page, b.store)).toEqual([b.entry])
      await card.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await expect(card).toHaveCount(0)
      expect(await stored(page, b.store)).toEqual([])
      await page.reload()
      await expect(page.getByText('Nothing in My Transit yet')).toBeVisible()

      await page.goto(b.path)
      await expect(star(page, b.name)).toHaveAttribute('aria-pressed', 'false')
    })

    test(`${mode}: the toast's Undo and a second tap both unsave`, async ({ page }) => {
      await page.goto(b.path)
      const s = star(page, b.name)
      await expect(async () => {
        await s.click()
        await expect(s).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
      }).toPass()
      await saveToast(page).getByRole('button', { name: 'Undo' }).click()
      await expect(s).toHaveAttribute('aria-pressed', 'false')
      await expect(saveToast(page)).toBeEmpty()
      expect(await stored(page, b.store)).toEqual([])
      await s.click()
      await expect(s).toHaveAttribute('aria-pressed', 'true')
      await s.click()
      await expect(s).toHaveAttribute('aria-pressed', 'false')
      await expect(saveToast(page)).toBeEmpty()
      await page.reload()
      await expect(star(page, b.name)).toHaveAttribute('aria-pressed', 'false')
      expect(await stored(page, b.store)).toEqual([])
    })
  }

  test('train with no destination: the station alone is saved; "Pick a destination" opens Going to', async ({
    page,
  }) => {
    await page.goto('/train/station/central')
    const s = star(page, 'Central')
    await s.click()
    await expect(s).toHaveAttribute('aria-pressed', 'true')
    await expect(saveToast(page)).toContainText('Central saved to My Transit')
    expect(await stored(page, 'bft-train-favourites')).toEqual([{ from: 'central', to: null }])
    await saveToast(page).getByRole('button', { name: 'Pick a destination' }).click()
    await expect(page.getByRole('dialog', { name: /Going to, from Central/ })).toBeVisible()
    await expect(saveToast(page)).toBeEmpty()
    await page.goto('/')
    await expect(page.locator('main a[href="/train/station/central"]')).toBeVisible()
  })

  test('ferry: several trips can be saved, and each is its own My Transit card', async ({ page }) => {
    await page.goto('/ferry')
    const first = star(page, 'Bulimba → Riverside')
    await expect(async () => {
      await first.click()
      await expect(first).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
    }).toPass()
    await page.goto('/ferry?from=317590&to=317584')
    const second = star(page, 'Riverside → Bulimba')
    await expect(async () => {
      await second.click()
      await expect(second).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
    }).toPass()
    expect(await stored(page, 'bft-ferry-favourites')).toEqual([
      { from: '317584', to: '317590' },
      { from: '317590', to: '317584' },
    ])
    await page.goto('/')
    await expect(page.locator('main a[href="/ferry?from=317584&to=317590"]')).toBeVisible()
    await expect(page.locator('main a[href="/ferry?from=317590&to=317584"]')).toBeVisible()
  })
}

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  modeTests()
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  modeTests()
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  modeTests()
})
