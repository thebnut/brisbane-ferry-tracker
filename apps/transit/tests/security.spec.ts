import { expect, test } from '@playwright/test'
import { hydrated, PAGES, watchCsp } from './csp.ts'

test('HTML has the nonce CSP; every executable inline script carries its nonce', async ({ request }) => {
  for (const path of PAGES) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    const csp = res.headers()['content-security-policy'] ?? ''
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce, path).toBeTruthy()
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
    expect(csp).toContain('frame-src https://challenges.cloudflare.com')
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    const html = await res.text()
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      if (/\bsrc=/.test(tag) || /type="application\/(ld\+)?json"/.test(tag)) continue
      expect(tag, `${path}: ${tag}`).toContain(`nonce="${nonce}"`)
    }
  }
})

test('static assets get the base headers but no CSP', async ({ request }) => {
  for (const path of ['/manifest.webmanifest', '/favicon-32.png']) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    expect(res.headers()['x-content-type-options'], path).toBe('nosniff')
    expect(res.headers()['content-security-policy'], path).toBeUndefined()
  }
})

test('no CSP violations while the pages load and hydrate, and the Ask box answers', async ({ page }) => {
  test.setTimeout(90_000)
  const violations = await watchCsp(page)
  for (const path of PAGES) {
    await page.goto(path)
    await hydrated(page)
  }
  // The deterministic Ask path end to end. Fixture mode has no Turnstile; tests/csp.staging.spec.ts covers that.
  await page.goto('/')
  await hydrated(page)
  const ask = page.getByRole('textbox', { name: 'Ask' })
  await ask.fill('next train from Bowen Hills to the airport')
  await ask.press('Enter')
  await expect(page.getByText(/From Bowen Hills station/)).toBeVisible()
  expect(violations).toEqual([])
})

test('the service worker registers under the CSP', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active, null, {
    timeout: 15_000,
  })
})
