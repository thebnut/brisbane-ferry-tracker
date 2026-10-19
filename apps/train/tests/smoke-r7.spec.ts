/** Regression test for Dev's smoke test round 7 (19 Oct 2026): /feedback is no longer a 404. */
import { expect, test } from '@playwright/test'

test('R7: /feedback sends people to the transit feedback sheet (train has none of its own)', async ({
  request,
}) => {
  const res = await request.get('/feedback', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  expect(res.headers().location).toMatch(/^https:\/\/[^/]+\/feedback$/)
})
