/**
 * R16-D1 (smoke round 16): on the bus search, with both /data/bus/stops.json and routes.json failing, one Try again
 * retries every failed list (stops, routes, and the map picker's tiles beside them), and a list that fails again keeps
 * only its own notice. Shared by the bus app (`base` '') and BrisbaneTransit's Bus tab ('/bus').
 */
import { expect, test } from '@playwright/test'
import { DATA_FAILURES, expectNoErrorPage, failData, pageErrors, watchData } from './data-failure.ts'
import { expectPrompt, FIRST_VISIT, prompt } from './onboarding.ts'

export function busSearchRetryTests(base: string): void {
  for (const how of DATA_FAILURES) {
    test.describe(`/data ${how}: one Try again`, () => {
      // R16-D1: with both lists failing, one Try again retries both; a list that fails again keeps only its notice.
      for (const again of [null, 'routes', 'stops'] as const) {
        test(`stop and route search both fail: one Try again retries both${again ? `, ${again} fails again` : ''}`, async ({
          page,
          context,
        }, testInfo) => {
          if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
          const errors = pageErrors(page)
          const { restore } = await failData(context, how)
          await page.goto(`${base}/`)
          await page
            .getByRole('searchbox', { name: /Stop name or number|Find a stop/ })
            .locator('visible=true')
            .fill('cultural')
          const stopsNotice = page
            .getByRole('status')
            .filter({ hasText: "Couldn't load the stop list" })
            .locator('visible=true')
          const routesNotice = page
            .getByRole('status')
            .filter({ hasText: "Couldn't load routes" })
            .locator('visible=true')
          await expect(stopsNotice).toBeVisible({ timeout: 20_000 })
          await expect(routesNotice).toBeVisible({ timeout: 20_000 })
          restore()
          const seen = await watchData(
            context,
            /\/data\/bus\/(stops|routes)\.json/,
            again ? new RegExp(`/${again}\\.json$`) : undefined,
          )
          await stopsNotice.getByRole('button', { name: 'Try again' }).click()
          await expect
            .poll(() => [...new Set(seen.map((p) => p.split('/').pop()))].sort())
            .toEqual(['routes.json', 'stops.json'])
          if (again) {
            // The failing list was asked for again (and retried once): it has failed by now, so its notice stays.
            await expect
              .poll(() => seen.filter((p) => p.endsWith(`/${again}.json`)).length, { timeout: 20_000 })
              .toBeGreaterThanOrEqual(2)
          }
          await expect(stopsNotice).toHaveCount(again === 'stops' ? 1 : 0, { timeout: 20_000 })
          await expect(routesNotice).toHaveCount(again === 'routes' ? 1 : 0, { timeout: 20_000 })
          if (again !== 'stops') {
            await expect(
              page
                .getByRole('list', { name: 'Matching stops' })
                .locator('visible=true')
                .getByText(/Cultural Centre/)
                .first(),
            ).toBeVisible()
          }
          await expectNoErrorPage(page)
          expect(errors).toEqual([])
        })
      }

      test('the long names failed, then the query changed: Try again still retries them', async ({
        page,
        context,
      }, testInfo) => {
        if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
        const errors = pageErrors(page)
        // Only lines.json fails (the route index loads): its query turns off for a short query, notice still showing.
        const { restore } = await failData(context, how)
        await context.route(/\/data\/bus\/(stops|routes)\.json/, (route) => route.continue())
        const search = page
          .getByRole('searchbox', { name: /Stop name or number|Find a stop/ })
          .locator('visible=true')
        await page.goto(`${base}/`)
        await search.fill('cultural')
        const routesNotice = page
          .getByRole('status')
          .filter({ hasText: "Couldn't load routes" })
          .locator('visible=true')
        await expect(routesNotice).toBeVisible({ timeout: 20_000 })
        await search.fill('zz')
        await expect(routesNotice).toBeVisible()
        restore()
        const seen = await watchData(context, /\/data\/bus\/lines\.json/)
        await routesNotice.getByRole('button', { name: 'Try again' }).click()
        await expect.poll(() => seen.length, { timeout: 20_000 }).toBeGreaterThan(0)
        await expect(routesNotice).toHaveCount(0, { timeout: 20_000 })
        await expectNoErrorPage(page)
        expect(errors).toEqual([])
      })

      test('map picker beside a failed search: its Try again retries the search lists too', async ({
        page,
        context,
      }, testInfo) => {
        if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
        const errors = pageErrors(page)
        const { restore } = await failData(context, how)
        await page.goto(`${base}/`)
        await page
          .getByRole('searchbox', { name: /Stop name or number|Find a stop/ })
          .locator('visible=true')
          .fill('cultural')
        const searchNotices = page
          .getByRole('status')
          .filter({ hasText: /Couldn't load (the stop list|routes)/ })
        await expect(searchNotices.locator('visible=true')).toHaveCount(2, { timeout: 20_000 })
        await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
        const picker = page.getByLabel('Bus stops map', { exact: true })
        const notice = picker.getByRole('status').filter({ hasText: "Couldn't load stops" })
        await expect(notice).toBeVisible({ timeout: 20_000 })
        restore()
        const seen = await watchData(context, /\/data\/bus\/(stops|routes|geo\/\w+)\.json/)
        await notice.getByRole('button', { name: 'Try again' }).click()
        await expect(picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })).toBeVisible({
          timeout: 20_000,
        })
        await expect(notice).toHaveCount(0)
        await expect(searchNotices).toHaveCount(0, { timeout: 20_000 })
        expect(seen.some((p) => p.endsWith('/stops.json'))).toBe(true)
        expect(seen.some((p) => p.endsWith('/routes.json'))).toBe(true)
        expect(seen.some((p) => p.includes('/geo/'))).toBe(true)
        expect(errors).toEqual([])
      })
    })
  }
}

/** The bus onboarding picker (bus app and BrisbaneTransit): its map and name-search notices show together. */
export function busOnboardingRetryTests(): void {
  for (const how of DATA_FAILURES) {
    test.describe(`/data ${how}: onboarding picker`, () => {
      test.use({ storageState: FIRST_VISIT })
      // R16-D1: the map's and the name search's notices show together; one Try again retries both lists.
      for (const again of [null, 'tiles', 'stops'] as const) {
        test(`onboarding picker (bus): map and name search say stops failed; one Try again loads both${again ? `, ${again} fail again` : ''}`, async ({
          page,
          context,
        }, testInfo) => {
          if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
          const errors = pageErrors(page)
          await context.grantPermissions(['geolocation'])
          await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
          const { restore } = await failData(context, how)
          await page.goto('/')
          await expectPrompt(page)
          await prompt(page).getByRole('button', { name: 'Yes' }).click()
          const picker = page.getByRole('dialog', { name: 'Set up your favourite stops' })
          const tray = picker.getByRole('complementary', { name: 'Your favourite stops' })
          const notice = picker.getByRole('status').filter({ hasText: "Couldn't load stops" })
          const searchNotice = tray.getByRole('status').filter({ hasText: "Couldn't load stops" })
          await expect(notice.first()).toBeVisible({ timeout: 20_000 })
          await tray.getByLabel('Find a stop by name').fill('cultural centre')
          await expect(searchNotice).toBeVisible({ timeout: 20_000 })
          await expect(notice).toHaveCount(2)
          await expect(tray.getByText('No stops match.')).toHaveCount(0)
          await expectNoErrorPage(page)
          restore()
          const seen = await watchData(
            context,
            /\/data\/bus\/(stops|geo\/\w+)\.json/,
            again === 'tiles' ? /\/geo\// : again === 'stops' ? /\/stops\.json$/ : undefined,
          )
          await searchNotice.getByRole('button', { name: 'Try again' }).click()
          await expect.poll(() => seen.some((p) => p.endsWith('/stops.json')), { timeout: 20_000 }).toBe(true)
          await expect.poll(() => seen.some((p) => p.includes('/geo/')), { timeout: 20_000 }).toBe(true)
          if (again !== 'stops') {
            await expect(tray.getByRole('button', { name: /Cultural Centre/ }).first()).toBeVisible({
              timeout: 20_000,
            })
            await expect(searchNotice).toHaveCount(0)
          }
          if (again !== 'tiles') {
            await expect(picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })).toBeVisible({
              timeout: 20_000,
            })
          }
          if (again === 'stops') {
            await expect
              .poll(() => seen.filter((p) => p.endsWith('/stops.json')).length)
              .toBeGreaterThanOrEqual(2)
            await expect(searchNotice).toBeVisible()
          }
          // What's left is the notice of the list that failed again (the map's when it's the tiles), or none.
          await expect(notice).toHaveCount(again ? 1 : 0, { timeout: 20_000 })
          await expect(searchNotice).toHaveCount(again === 'stops' ? 1 : 0)
          expect(errors).toEqual([])
        })
      }
    })
  }
}
