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

test('hashed build assets are cached immutably; HTML and the service worker are not', async ({ request }) => {
  const html = await request.get('/')
  expect(html.headers()['cache-control'] ?? '').not.toMatch(/immutable/)
  const body = await html.text()
  const assets = [...new Set(body.match(/\/assets\/[^"'\s?#]+\.(?:js|css)/g) ?? [])]
  expect(assets.some((a) => a.endsWith('.js'))).toBe(true)
  expect(assets.some((a) => a.endsWith('.css'))).toBe(true)
  for (const path of assets) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    expect(res.headers()['cache-control'], path).toBe('public, max-age=31536000, immutable')
    expect(res.headers()['x-content-type-options'], path).toBe('nosniff')
  }
  for (const path of ['/sw.js', '/manifest.webmanifest']) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    expect(res.headers()['cache-control'] ?? '', path).not.toMatch(/immutable|max-age=[1-9]/)
  }
})

test('every Worker response names its build (x-bft-build; "dev" locally, the deployed sha on a host)', async ({
  request,
}) => {
  for (const path of ['/', '/no-such-page']) {
    const res = await request.get(path)
    expect(res.headers()['x-bft-build'], `${path} ${res.status()}`).toBe('dev')
  }
})
