import { unexpectedCsp } from '@bft/ui/e2e/csp-expected.ts'
import { expect, test } from '@playwright/test'
import { hydrated, PAGES, watchCsp } from './csp.ts'

/**
 * The live CSP on staging (no fixtures, so the Ask box uses the real invisible Turnstile widget): no unexpected
 * violation on every page, after a client route change, then while Turnstile's script and challenge iframe load and a
 * deterministic question is answered (no LLM call, no spend). It doesn't try to solve a challenge. Staging has GA on,
 * so the Google Ads and signals beacons the CSP refuses on purpose (@bft/ui/e2e/csp-expected.ts, R44-G1 after a route
 * change) are expected; any other violation or page error fails. Run: `pnpm test:staging` (BASE_URL overrides the host).
 */
test('staging: no unexpected CSP violation on every page, a route change and while Turnstile loads', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const violations = await watchCsp(page)
  for (const path of PAGES) {
    await page.goto(path)
    await hydrated(page)
  }
  // A client route change: gtag's hits for the new page (Google signals' duplicate is refused, R44-G1).
  await page.goto('/bus/stop/10802')
  await hydrated(page)
  await page.locator('a[href="/ferry"]:visible').first().click()
  await page.waitForURL((u) => u.pathname === '/ferry')
  await page.waitForTimeout(3_000)
  await page.goto('/')
  await hydrated(page)
  const ask = page.getByRole('textbox', { name: 'Ask' })
  await ask.focus()
  await page.waitForFunction(
    () => !!document.querySelector('script[src^="https://challenges.cloudflare.com/"]'),
  )
  // The challenge iframe sits in Turnstile's closed shadow root, so look for its frame rather than an element. In an
  // automated browser the challenge itself may fail (600010): only loading it under the CSP is checked here.
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/')), {
      timeout: 20_000,
    })
    .toBe(true)
  const answered = page.waitForResponse(
    (r) => r.url().endsWith('/v1/ask') && r.request().method() === 'POST',
    { timeout: 20_000 },
  )
  await ask.fill('next ferry from Bulimba to Riverside')
  await ask.press('Enter')
  const body = await (await answered).json()
  // 'cache' when the same parsed question was answered in the last few seconds.
  expect(['deterministic', 'cache']).toContain(body.source)
  await expect(page.locator('[data-ask-source]')).toBeVisible()
  expect(unexpectedCsp(violations)).toEqual([])
})
