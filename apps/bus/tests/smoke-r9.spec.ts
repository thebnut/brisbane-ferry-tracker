/**
 * Regression test for the lead's staging check before round 9 (19 Oct 2026): on the bus home at 400 px the fixed
 * "Find a stop" sheet and the bottom nav covered the end of the footer, R8-FB's feedback link included, even
 * scrolled to the bottom.
 */
import { expect, test } from '@playwright/test'

for (const height of [800, 640])
  test(`the home at 400×${height}: scrolled to the bottom, the footer clears the Find a stop sheet`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 400, height })
    await page.goto('/')
    await expect(page.getByText('Find a stop').first()).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const footer = page.locator('footer')
    // The footer's links, its last line included, are what a tap there reaches: not the sheet or the nav.
    for (const link of [
      footer.getByRole('link', { name: 'Send Feedback & Ideas' }),
      footer.getByRole('link', { name: 'About and data sources' }),
    ]) {
      const box = await link.boundingBox()
      expect(box).not.toBeNull()
      if (!box) continue
      const hit = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('footer a')?.textContent ?? null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )
      expect(hit).toContain(await link.textContent())
    }
    await footer.getByRole('link', { name: 'Send Feedback & Ideas' }).click({ trial: true, timeout: 5_000 })
  })
