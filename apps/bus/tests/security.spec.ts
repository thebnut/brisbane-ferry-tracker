import { expect, test } from '@playwright/test'

// The main pages, server-rendered by the Worker with a per-request nonce CSP (workers/security.ts).
const PAGES = ['/', '/stop/10802', '/nearby', '/alerts', '/map', '/about']

test('HTML has the nonce CSP; every executable inline script carries its nonce', async ({ request }) => {
  for (const path of PAGES) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    const csp = res.headers()['content-security-policy'] ?? ''
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce, path).toBeTruthy()
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    const html = await res.text()
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
      if (/\bsrc=/.test(tag) || /type="application\/(ld\+)?json"/.test(tag)) continue
      expect(tag, `${path}: ${tag}`).toContain(`nonce="${nonce}"`)
    }
  }
})

test('static assets get the base headers but no CSP', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  expect(res.headers()['x-content-type-options']).toBe('nosniff')
  expect(res.headers()['content-security-policy']).toBeUndefined()
})

test('no CSP violations while the main pages load and hydrate', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text())
  })
  await page.exposeFunction('reportCspViolation', (v: string) => violations.push(v))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    )
  })
  for (const path of PAGES) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  expect(violations).toEqual([])
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
