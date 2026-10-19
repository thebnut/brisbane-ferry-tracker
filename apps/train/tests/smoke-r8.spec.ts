/** Regression test for Dev's smoke test round 8 (19 Oct 2026), R8-FB: every page's footer links to feedback. */
import { expect, test } from '@playwright/test'

for (const path of ['/station/central', '/'])
  test(`R8-FB: ${path} has a footer Feedback link to /feedback (the transit feedback sheet)`, async ({
    page,
  }) => {
    await page.goto(path)
    const link = page.locator('footer').getByRole('link', { name: 'Send Feedback & Ideas' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/feedback')
    // /feedback redirects to the transit site's (smoke-r7.spec.ts checks where): the link is a document link.
    const res = await page.request.get('/feedback', { maxRedirects: 0 })
    expect(res.status()).toBe(302)
  })
