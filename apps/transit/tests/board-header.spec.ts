/**
 * THE-118 PR 5, one board header and filter row on every board, and Ferry as a terminal board:
 *  - the header: mode kicker, the place's name, one sub-line with the alert count, the labelled star;
 *  - one row of 44 px chips (Bus: All routes, routes, Map, Now ▾; Train: All, Going to… ▾, Express, Map, Now ▾; Ferry:
 *    All, To… ▾, Express, Map, Now ▾), plus ⇄ with a destination set;
 *  - the status line below the header, above the rows;
 *  - `/ferry/terminal/:slug?to=` boards, old `/ferry?from=&to=` links redirecting there, saved favourites opening
 *    with "To" set, three terminal pairs including cross-river (F2x).
 * Nothing here depends on the time of day: no row's wording or countdown is asserted, only what the board is for.
 */
import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

const BOARDS = [
  { mode: 'bus', url: '/bus/stop/10802', kicker: 'Bus stop', name: /Cultural Centre/, chips: ['All routes', 'Map', 'Now'] },
  {
    mode: 'train',
    url: '/train/station/central',
    kicker: 'Train station',
    name: /^Central$/,
    chips: ['All', 'Going to…', 'Express', 'Map', 'Now'],
  },
  {
    mode: 'ferry',
    url: '/ferry/terminal/bulimba',
    kicker: 'Ferry terminal',
    name: /^Bulimba$/,
    // Express too, but only while express services are on the board (as before), so not at every hour.
    chips: ['All', 'To…', 'Map', 'Now'],
  },
] as const

const header = (page: Page) => page.locator('[data-board-header]')
const chips = (page: Page) => header(page).locator('[data-filter-row]')

/** The ferry board's three trips: along the river, and two cross-river (F21 with the F1, and the F22 only). */
const PAIRS = [
  { from: ['317583', 'hawthorne', 'Hawthorne'], to: ['317590', 'riverside', 'Riverside'] },
  { from: ['317584', 'bulimba', 'Bulimba'], to: ['317587', 'teneriffe', 'Teneriffe'] },
  { from: ['317589', 'sydney-street', 'Sydney Street'], to: ['317581', 'dockside', 'Dockside'] },
] as const
const TERMINALS = JSON.parse(
  readFileSync(new URL('../../ferry/app/data/terminals.json', import.meta.url), 'utf8'),
) as Array<{ id: string; routes: string[] }>
/** The services that call at both terminals. */
const both = (a: string, b: string) => {
  const at = (id: string) => TERMINALS.find((t) => t.id === id)?.routes ?? []
  return at(a).filter((r) => at(b).includes(r))
}

function suite(desktop: boolean) {
  for (const b of BOARDS)
    test.describe(b.mode, () => {
      test('header: kicker, name, sub-line with the alert count, labelled star; then the chips', async ({ page }) => {
        await page.goto(b.url)
        const h = header(page)
        await expect(h.locator('[data-kicker]')).toHaveText(b.kicker)
        await expect(h.getByRole('heading').first()).toHaveText(b.name)
        await expect(h.locator('[data-board-facts] [data-board-alerts] a')).toHaveText(/Alerts|\d+ alerts?/)
        await expect(h.locator('[data-star]')).toHaveText(/^Saved?\b/)
        for (const c of b.chips) await expect(chips(page).getByText(c, { exact: true }).first()).toBeVisible()
        // Every chip is a 44 px target.
        for (const box of await chips(page).locator('[data-chip], a').evaluateAll((els) =>
          els.map((e) => e.getBoundingClientRect().height),
        ))
          expect(box).toBeGreaterThanOrEqual(44)
        // One page width: the chip row scrolls on its own, the page doesn't.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      })

      test('the status line sits below the header and above the rows', async ({ page }) => {
        await page.goto(b.url)
        const line = page.locator('[data-status-line]')
        await expect(line).toBeVisible()
        const head = await header(page).boundingBox()
        const status = await line.boundingBox()
        const rows = await page.locator('main ol, main [role=status]').first().boundingBox()
        if (!head || !status || !rows) throw new Error('missing layout')
        expect(status.y).toBeGreaterThanOrEqual(head.y + head.height)
        expect(status.y + status.height).toBeLessThanOrEqual(rows.y + 1)
      })

      test('Now ▾ asks the board for a later time', async ({ page }) => {
        await page.goto(b.url)
        const select = chips(page).getByLabel('Depart from')
        const value = await select.locator('option:not([disabled])').nth(1).getAttribute('value')
        const asked = page.waitForRequest((r) => r.url().includes('/departures') && r.url().includes(`at=${value}`))
        await select.selectOption(value as string)
        await asked
        const words = chips(page).locator('[data-chip=now] > span')
        await expect(words).toHaveText(/^From \d+(AM|PM)/)
        await select.selectOption('')
        await expect(words).toHaveText('Now')
      })
    })

  test.describe('ferry terminal board', () => {
    for (const p of PAIRS)
      test(`old link ${p.from[2]} → ${p.to[2]} lands on its board with "To" set`, async ({ page }) => {
        await page.goto(`/ferry?from=${p.from[0]}&to=${p.to[0]}`)
        await expect(page).toHaveURL(`/ferry/terminal/${p.from[1]}?to=${p.to[1]}`)
        await expect(header(page).getByRole('heading').first()).toHaveText(p.from[2])
        await expect(chips(page).getByRole('button', { name: `To ${p.to[2]}` })).toHaveAttribute(
          'aria-haspopup',
          'dialog',
        )
        const board = page.locator('[data-board=outbound]')
        await expect(board).toHaveAttribute('aria-label', `${p.from[2]} to ${p.to[2]}`)
        // Whatever the hour: every row shown is a service that goes there (the F22 alone from Sydney Street).
        const services = both(p.from[0], p.to[0])
        if (p.to[1] === 'dockside') expect(services).toEqual(['F22'])
        for (const code of await board.locator('[data-tile=service]').allTextContents())
          expect(services).toContain(code.replace('Service ', ''))
        // Desktop keeps both directions until the return-board rule (THE-118 PR 7); phones show one.
        const back = page.locator('[data-board=inbound]')
        if (desktop) await expect(back).toHaveAttribute('aria-label', `${p.to[2]} to ${p.from[2]}`)
        else await expect(back).toBeHidden()
      })

    test('a terminal board without "To" lists every departure; the sheet sets "To"', async ({ page }) => {
      await page.goto('/ferry/terminal/bulimba')
      await expect(page.locator('[data-board=outbound]')).toHaveAttribute('aria-label', 'Departures from Bulimba')
      await expect(page.locator('[data-board=inbound]')).toHaveCount(0)
      await expect(chips(page).getByRole('button', { name: 'Swap direction' })).toHaveCount(0)
      await chips(page).getByRole('button', { name: 'To…' }).click()
      const sheet = page.getByRole('dialog', { name: 'To, from Bulimba' })
      await sheet.getByRole('button', { name: 'Teneriffe', exact: true }).click()
      await expect(page).toHaveURL('/ferry/terminal/bulimba?to=teneriffe')
      await expect(chips(page).getByRole('button', { name: 'To Teneriffe' })).toBeVisible()
      // "Any destination" clears it again.
      await chips(page).getByRole('button', { name: 'To Teneriffe' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Any destination' }).click()
      await expect(page).toHaveURL('/ferry/terminal/bulimba')
    })

    test('⇄ flips the direction', async ({ page }) => {
      await page.goto('/ferry/terminal/bulimba?to=riverside')
      await chips(page).getByRole('button', { name: 'Swap direction' }).click()
      await expect(page).toHaveURL('/ferry/terminal/riverside?to=bulimba')
      await expect(header(page).getByRole('heading').first()).toHaveText('Riverside')
      await expect(chips(page).getByRole('button', { name: 'To Bulimba' })).toBeVisible()
    })

    test('a saved favourite opens its board with "To" set', async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() =>
        localStorage.setItem('bft-ferry-favourites', JSON.stringify([{ from: '317584', to: '317587' }])),
      )
      await page.reload()
      await page.locator('main a[href="/ferry/terminal/bulimba?to=teneriffe"]').first().click()
      await expect(page).toHaveURL('/ferry/terminal/bulimba?to=teneriffe')
      await expect(chips(page).getByRole('button', { name: 'To Teneriffe' })).toBeVisible()
      await expect(header(page).locator('[data-star]')).toHaveAttribute('aria-pressed', 'true')
    })
  })

  test('train: ⇄ flips "Going to"', async ({ page }) => {
    await page.goto('/train/station/roma-street?to=indooroopilly')
    await expect(chips(page).getByRole('button', { name: 'To Indooroopilly' })).toBeVisible()
    await chips(page).getByRole('button', { name: 'Swap direction' }).click()
    await expect(page).toHaveURL('/train/station/indooroopilly?to=roma-street')
    await expect(header(page).getByRole('heading').first()).toHaveText('Indooroopilly')
  })
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  suite(false)
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  suite(true)
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  suite(true)
})
