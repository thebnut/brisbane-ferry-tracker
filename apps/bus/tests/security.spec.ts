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
