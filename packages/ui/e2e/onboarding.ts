/**
 * P4: the first-visit onboarding prompt comes up over any page of a fresh browser after an idle moment. Suites that
 * aren't about it start with it answered (`onboardingAnswered`, the configs' default storageState), so it never covers
 * what they click; the onboarding specs start from a real first visit (`FIRST_VISIT`).
 */
import { expect, type Locator, type Page } from '@playwright/test'

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

/** Phone widths the prompt must leave the page's fixed controls usable at (R15). */
export const PHONE_WIDTHS = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]

/** `target` shows, what is at its centre is itself (not the prompt or anything else), and it takes a click (R15). */
export async function expectUnobscured(target: Locator): Promise<void> {
  await expect(target).toBeVisible()
  await expect(target).toBeInViewport({ ratio: 1 })
  const hit = await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return at == null ? 'nothing' : el === at || el.contains(at) ? 'self' : at.outerHTML.slice(0, 120)
  })
  expect(hit).toBe('self')
  await target.click({ trial: true, timeout: 5_000 })
}

/** The prompt overlaps none of the fixed bottom chrome (`data-bft-dock`: nav, section pills, search sheet). */
export async function expectPromptClearOfDocks(page: Page): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const p = document.querySelector('[data-onboarding-prompt]')?.getBoundingClientRect()
    if (!p) return ['no prompt']
    return [...document.querySelectorAll('[data-bft-dock]')]
      .filter((d) => getComputedStyle(d).position === 'fixed')
      .map((d) => ({ d, r: d.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          r.height > 0 && r.top < p.bottom && r.bottom > p.top && r.left < p.right && r.right > p.left,
      )
      .map(({ d }) => d.outerHTML.slice(0, 80))
  })
  expect(overlaps).toEqual([])
}
