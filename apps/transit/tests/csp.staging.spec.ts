import { expect, test } from '@playwright/test'
import { hydrated, PAGES, watchCsp } from './csp.ts'

/**
 * The live CSP on staging (no fixtures, so the Ask box uses the real invisible Turnstile widget): zero violations on
 * every page, then Turnstile's script and challenge iframe load and a deterministic question is answered (no LLM call,
 * no spend). It doesn't try to solve a challenge. Run: `pnpm test:staging` (BASE_URL overrides the host).
 */
test('staging: zero CSP violations on every page and while Turnstile loads for the Ask box', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const violations = await watchCsp(page)
  for (const path of PAGES) {
    await page.goto(path)
    await hydrated(page)
  }
  await page.goto('/')
  await hydrated(page)
  const ask = page.getByRole('textbox', { name: 'Ask' })
  await ask.focus()
  await page.waitForFunction(
    () => !!document.querySelector('script[src^="https://challenges.cloudflare.com/"]'),
  )
  await expect(page.locator('iframe[src^="https://challenges.cloudflare.com/"]')).toHaveCount(1, {
    timeout: 20_000,
  })
  const answered = page.waitForResponse((r) => r.url().endsWith('/v1/ask') && r.request().method() === 'POST')
  await ask.fill('next ferry from Bulimba to Riverside')
  await ask.press('Enter')
  const body = await (await answered).json()
  expect(body.source).toBe('deterministic')
  await expect(page.locator('[data-ask-source]')).toBeVisible()
  expect(violations).toEqual([])
})
