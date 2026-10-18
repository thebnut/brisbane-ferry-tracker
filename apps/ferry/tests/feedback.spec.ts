import { expect, test } from '@playwright/test'

// /api/feedback is always stubbed here: tests never reach the Worker's relay or the real n8n webhook.

test('footer feedback: validation, focus trap and Escape, then a stubbed successful submit', async ({
  page,
}) => {
  const posted: unknown[] = []
  await page.route('**/api/feedback', async (route) => {
    posted.push(route.request().postDataJSON())
    await route.fulfill({ json: { success: true, message: 'Feedback submitted successfully' } })
  })
  await page.goto('/privacy')
  const open = page.getByRole('button', { name: 'Send Feedback & Ideas' })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Share your feedback' })
  await expect(dialog).toBeVisible()

  // Escape closes it and returns focus to the footer button.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()

  await open.click()
  await expect(dialog).toBeVisible()
  // Focus stays inside the modal dialog while tabbing.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  }

  const box = dialog.getByLabel(/Your feedback/)
  const submit = dialog.getByRole('button', { name: 'Submit feedback' })
  await box.fill('too short')
  await expect(dialog.getByText('Minimum 10 characters')).toBeVisible()
  await expect(submit).toBeDisabled()
  await box.fill('Please add a Teneriffe to Bulimba favourite.')
  await dialog.getByLabel(/Email/).fill('not-an-email')
  await submit.click()
  await expect(dialog.getByRole('alert')).toHaveText('Please provide a valid email address')
  expect(posted).toEqual([])

  await dialog.getByLabel(/Email/).fill('rider@example.com')
  await dialog.getByLabel(/Name/).fill('Rider')
  await submit.click()
  await expect(dialog.getByRole('status')).toContainText('Thank you!')
  expect(posted).toEqual([
    { feedback: 'Please add a Teneriffe to Bulimba favourite.', email: 'rider@example.com', name: 'Rider' },
  ])
  // Closes itself after 2 s, like the legacy modal.
  await expect(dialog).toBeHidden({ timeout: 4000 })
})

test('feedback: a server error is shown and the form is kept for a retry', async ({ page }) => {
  await page.route('**/api/feedback', (route) =>
    route.fulfill({ status: 500, json: { error: 'Failed to submit feedback' } }),
  )
  await page.goto('/privacy')
  await page.getByRole('button', { name: 'Send Feedback & Ideas' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share your feedback' })
  await dialog.getByLabel(/Your feedback/).fill('The map is great, thank you.')
  await dialog.getByRole('button', { name: 'Submit feedback' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Failed to submit feedback')
  await expect(dialog.getByLabel(/Your feedback/)).toHaveValue('The map is great, thank you.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
