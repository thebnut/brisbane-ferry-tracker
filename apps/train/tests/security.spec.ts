import { randomBytes } from 'node:crypto'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { expect, test } from '@playwright/test'

// The main pages, server-rendered by the Worker with a per-request nonce CSP (workers/security.ts).
const PAGES = ['/', '/station/roma-street', '/stations', '/map', '/alerts']

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

/** The handshake answer of a raw WebSocket upgrade (Playwright exposes no handshake headers). */
function upgrade(url: string): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      },
    })
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      resolve({ status: res.statusCode ?? 0, headers: res.headers })
    })
    req.on('response', (res) => {
      res.resume()
      resolve({ status: res.statusCode ?? 0, headers: res.headers })
    })
    req.on('error', reject)
    req.end()
  })
}

test('the trip WebSocket upgrade (101) names its build too', async ({ page }) => {
  // TRIP_WS=1 in the test server: the service detail page opens /v1/train/trips/{key}/ws.
  const opened = page.waitForEvent('websocket', (ws) => /\/v1\/train\/trips\/.+\/ws$/.test(ws.url()))
  await page.goto('/station/central')
  await page.locator('[data-board=central] [data-testid=departure] a').first().click()
  const ws = await opened
  const res = await upgrade(ws.url().replace(/^ws/, 'http'))
  expect(res.status).toBe(101)
  expect(res.headers['x-bft-build']).toBe('dev')
})

test('GA4 is off here (GA_MEASUREMENT_ID unset): no gtag bootstrap or tag, no Google origin in the CSP', async ({
  request,
}) => {
  const res = await request.get('/')
  expect(res.headers()['content-security-policy']).not.toMatch(/google/i)
  const html = await res.text()
  expect(html).not.toContain('dataLayer')
  expect(html).not.toContain('googletagmanager')
})
