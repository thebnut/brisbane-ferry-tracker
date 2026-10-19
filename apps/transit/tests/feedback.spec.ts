import { expect, test } from '@playwright/test'
import {
  DUMMY_TOKEN,
  stubTurnstile,
  TEST_SITEKEY,
  turnstileRenders,
} from '../../ferry/tests/turnstile-stub.ts'

// The mounted Ferry footer's feedback sheet, on transit. /api/feedback and the Turnstile script are stubbed.
test('mounted ferry feedback sheet renders the Turnstile widget and sends its token', async ({ page }) => {
  const posted: unknown[] = []
  const turnstile = await stubTurnstile(page)
  await page.route('**/api/feedback', async (route) => {
    posted.push(route.request().postDataJSON())
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('/ferry/privacy')
  expect(turnstile.requests()).toBe(0)
  await page.getByRole('button', { name: 'Send Feedback & Ideas' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share your feedback' })
  await dialog.getByLabel(/Your feedback/).fill('Feedback from the transit Ferry tab.')
  await dialog.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(dialog.getByRole('status')).toContainText('Thank you!')
  expect(posted).toEqual([
    { feedback: 'Feedback from the transit Ferry tab.', email: '', name: '', turnstileToken: DUMMY_TOKEN },
  ])
  expect(await turnstileRenders(page)).toContainEqual({
    sitekey: TEST_SITEKEY,
    action: 'feedback',
    appearance: 'interaction-only',
  })
})

test('R7: the home footer has the feedback entry, and /feedback opens the sheet there', async ({ page }) => {
  await stubTurnstile(page)
  await page.goto('/')
  await page.locator('footer').getByRole('link', { name: 'Send Feedback & Ideas' }).click()
  await expect(page.getByRole('dialog', { name: 'Share your feedback' })).toBeVisible()
  await page.goto('/feedback')
  await expect(page).toHaveURL(/\/\?feedback=1$/)
  await expect(page.getByRole('dialog', { name: 'Share your feedback' })).toBeVisible()
})
