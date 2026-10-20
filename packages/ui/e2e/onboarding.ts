/**
 * P4: the first-visit onboarding prompt comes up over any page of a fresh browser after an idle moment. Suites that
 * aren't about it start with it answered (`onboardingAnswered`, the configs' default storageState), so it never covers
 * what they click; the onboarding specs start from a real first visit (`FIRST_VISIT`).
 */
import { expect, type Page } from '@playwright/test'

/** @bft/ui/onboarding ONBOARDING_KEY. */
export const ONBOARDING_KEY = 'bft-onboarding'

export const onboardingAnswered = (baseURL: string) => ({
  cookies: [],
  origins: [{ origin: baseURL, localStorage: [{ name: ONBOARDING_KEY, value: '1' }] }],
})

/** A browser that has never been here. */
export const FIRST_VISIT = { cookies: [], origins: [] }

export const prompt = (page: Page) => page.locator('[data-onboarding-prompt]')

/** The prompt shows (it waits for ~2 s of no input), with focus left where it was. */
export async function expectPrompt(page: Page): Promise<void> {
  await expect(prompt(page)).toBeVisible({ timeout: 15_000 })
  await expect(prompt(page).getByRole('heading', { name: 'Set up your favourite stops?' })).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.closest('[data-onboarding-prompt]') == null)).toBe(
    true,
  )
}

/** Long enough for the prompt to have come up, had it been going to. */
export async function expectNoPrompt(page: Page): Promise<void> {
  await page.waitForTimeout(3_500)
  await expect(prompt(page)).toHaveCount(0)
}
