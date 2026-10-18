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

/** Collect CSP violations: the console messages and the DOM `securitypolicyviolation` events. */
export async function watchCsp(page: Page): Promise<string[]> {
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
  return violations
}

export async function hydrated(page: Page) {
  // Not 'networkidle': live boards poll. Hydration has run once the router's client state exists.
  await page.waitForFunction(
    () => '__reactRouterRouteModules' in window && document.readyState === 'complete',
  )
  if (/\/map$/.test(new URL(page.url()).pathname))
    await page.locator('canvas.maplibregl-canvas').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
}
