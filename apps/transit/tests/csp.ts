/** Shared by security.spec.ts (local, fixtures) and csp.staging.spec.ts (deployed staging). */
import type { Page } from '@playwright/test'

// Every transit page plus a page of each mounted mode, server-rendered by the Worker with a per-request nonce CSP
// (workers/security.ts).
export const PAGES = [
  '/',
  '/nearby?lat=-27.4717&lon=153.0206',
  '/alerts',
  '/ferry',
  '/ferry/terminal/bulimba',
  '/ferry/privacy',
  '/train',
  '/train/station/roma-street',
  '/bus',
  '/bus/stop/10802',
  '/bus/about',
  // MapLibre pages: style, tiles, glyphs and sprites from OpenFreeMap, a blob: web worker.
  '/train/map',
  '/bus/map',
]

/**
 * Turnstile's challenge iframe is its own document under its own CSP (it probes `fetch('data:,')` and its
 * connect-src refuses it). Those violations are Cloudflare's, not this page's policy, so they don't count.
 */
const TURNSTILE_FRAME = 'https://challenges.cloudflare.com/cdn-cgi/'

/**
 * Collect this page's CSP violations: console messages (except those from Turnstile's own iframe) and the top
 * document's `securitypolicyviolation` events. Uncaught page errors are collected too: a blocked script often shows
 * up only as a failed hydration.
 */
export async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = []
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.location().url.startsWith(TURNSTILE_FRAME)) return
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text())
  })
  await page.exposeFunction('reportCspViolation', (v: string) => violations.push(v))
  await page.addInitScript(() => {
    if (window !== window.top) return
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`,
      ),
    )
  })
  return violations
}

export async function hydrated(page: Page) {
  // Not 'networkidle': live boards poll. React has hydrated once it has committed fibers onto the server-rendered DOM
  // (`__reactFiber$…` on <body>); the router's globals alone appear before the client entry has even loaded (Codex
  // review of #54).
  await page.waitForFunction(
    () =>
      document.readyState === 'complete' &&
      Object.keys(document.body).some((k) => k.startsWith('__reactFiber$')),
  )
  if (/\/map$/.test(new URL(page.url()).pathname))
    await page.locator('canvas.maplibregl-canvas').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
}
