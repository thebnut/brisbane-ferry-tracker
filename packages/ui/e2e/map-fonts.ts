/**
 * R14-M1: a map that renders asks only for resources that exist. The cluster counts of the stop picker (and its stop
 * names, from zoom 16) had no `text-font`, so MapLibre asked openfreemap for its default "Open Sans Regular,Arial
 * Unicode MS Regular" glyphs and the console showed a 404 on every map open. Headless Chromium has no WebGL by default
 * (maps show "Map unavailable"), so these specs use SwiftShader, as the R14 smoke run did, so the map really renders
 * and requests its glyphs.
 */
import { expect, type Page } from '@playwright/test'

/** Launch options for a WebGL-capable headless Chromium (software rendering). */
export const WEBGL_LAUNCH = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
}

const GLYPH = /\/fonts\/[^/]+\/\d+-\d+\.pbf/

export interface MapRequests {
  /** Every 4xx/5xx response and failed-resource console error. */
  bad: string[]
  /** Every glyph request URL (decoded), and those still in flight. */
  glyphs: string[]
  pending: Set<string>
  /** When the last glyph request started or ended. */
  lastGlyphAt: number
}

export function watchMapRequests(page: Page): MapRequests {
  const seen: MapRequests = { bad: [], glyphs: [], pending: new Set(), lastGlyphAt: 0 }
  const done = (url: string) => {
    if (!GLYPH.test(url)) return
    seen.pending.delete(url)
    seen.lastGlyphAt = Date.now()
  }
  page.on('response', (r) => {
    if (r.status() >= 400) seen.bad.push(`${r.status()} ${r.url()}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) seen.bad.push(m.text())
  })
  page.on('request', (r) => {
    if (!GLYPH.test(r.url())) return
    seen.glyphs.push(decodeURIComponent(r.url()))
    seen.pending.add(r.url())
    seen.lastGlyphAt = Date.now()
  })
  page.on('requestfinished', (r) => done(r.url()))
  page.on('requestfailed', (r) => done(r.url()))
  return seen
}

/**
 * Waits until the map is idle with `idle` matched by its `data-map-idle` (MapView: the zoom and each of our symbol
 * layers' rendered feature count, set only once tiles, glyphs and our layers are drawn), so the labels that need a
 * font are on screen; then until glyph requests have settled (at least one finished, none in flight, none started for
 * 1.5 s). Then every glyph request must be a Noto Sans stack the basemap serves, and nothing may have answered 4xx/5xx.
 */
export async function expectMapFontsServed(page: Page, seen: MapRequests, idle: RegExp): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Map unavailable on this device')).toHaveCount(0)
  await expect(page.locator('[data-map-idle]').first()).toHaveAttribute('data-map-idle', idle, {
    timeout: 20_000,
  })
  await expect
    .poll(() => seen.glyphs.length > 0 && seen.pending.size === 0 && Date.now() - seen.lastGlyphAt > 1_500, {
      timeout: 20_000,
      intervals: [250],
    })
    .toBe(true)
  for (const g of seen.glyphs) expect(g, 'glyph stack').toMatch(/\/fonts\/Noto Sans [A-Za-z]+\//)
  expect(seen.bad).toEqual([])
}
