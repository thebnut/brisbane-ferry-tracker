/**
 * R13-R1: a browser without WebGL. Every page's canvases refuse WebGL contexts (`getContext` returns null, as on a
 * device with WebGL off or unsupported), so MapLibre can't start. Pages must still render; maps show their
 * "Map unavailable" panel.
 */
import { expect, type Page } from '@playwright/test'

export async function disableWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (/webgl/i.test(kind)) return null
      return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest)
    } as typeof original
  })
}

/** Page errors, the one "Map unavailable" warning, and any MapLibre chunk the page fetched (none without WebGL). */
export function watchMapFailures(page: Page): { errors: string[]; warnings: string[]; mapChunks: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const mapChunks: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().startsWith('Map unavailable')) warnings.push(m.text())
  })
  page.on('request', (r) => {
    if (/\/assets\/(maplibre|MapView)[^/]*\.js/i.test(r.url())) mapChunks.push(r.url())
  })
  return { errors, warnings, mapChunks }
}

/** The panel is in the map's place, MapLibre never started, and the error page is nowhere. */
export async function expectMapUnavailable(page: Page): Promise<void> {
  await expect(page.getByText('Map unavailable on this device')).toBeVisible()
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0)
  // THE-112: the locate-me button belongs to a started map; the panel never shows a broken one.
  await expect(page.getByRole('button', { name: 'Show my location' })).toHaveCount(0)
}
