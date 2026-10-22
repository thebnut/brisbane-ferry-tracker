/**
 * THE-112: the locate-me button on every map (packages/ui/src/map/LocateControl.tsx). With location allowed, a tap shows
 * the "you are here" dot and moves the map onto it; with location blocked, it says so on the map. The specs run with
 * WebGL (SwiftShader, WEBGL_LAUNCH from map-fonts.ts) so the map really starts.
 */
import { type BrowserContext, expect, type Locator } from '@playwright/test'

/** New Farm Park: away from the routes, stops and default views the specs open on, so a move is visible. */
export const NEW_FARM = { latitude: -27.4695, longitude: 153.0525 }

export async function allowLocation(context: BrowserContext, at = NEW_FARM): Promise<void> {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation(at)
}

export const locateButton = (map: Locator) => map.getByRole('button', { name: 'Show my location' })
export const youAreHere = (map: Locator) => map.locator('[data-you]')

/** How far (px) the dot is from the middle of the map, or Infinity when either is missing. */
export async function offCentre(map: Locator): Promise<number> {
  const box = await map.boundingBox()
  const you = await youAreHere(map).boundingBox()
  if (!box || !you) return Number.POSITIVE_INFINITY
  return Math.hypot(
    you.x + you.width / 2 - (box.x + box.width / 2),
    you.y + you.height / 2 - (box.y + box.height / 2),
  )
}

/** Tap the button: the dot shows and the map ends up centred on it. */
export async function expectLocatesOnTap(map: Locator): Promise<void> {
  const button = locateButton(map)
  await expect(button).toBeVisible({ timeout: 20_000 })
  await button.click()
  await expect(youAreHere(map)).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => offCentre(map), { timeout: 15_000 }).toBeLessThan(20)
  await expect(map.getByRole('status')).toHaveCount(0)
}

/** Location blocked: a tap gives the short line on the map, no dot, and the button stays usable. */
export async function expectDeniedOnTap(map: Locator): Promise<void> {
  const button = locateButton(map)
  await expect(button).toBeVisible({ timeout: 20_000 })
  await button.click()
  await expect(map.getByRole('status')).toHaveText('Location is off. Allow it in your browser settings.')
  await expect(youAreHere(map)).toHaveCount(0)
  await expect(button).toBeEnabled()
}

/** Pan with the keyboard (MapLibre's canvas handles the arrow keys) until the dot is well off the middle. */
export async function panAway(map: Locator): Promise<void> {
  await map.locator('canvas.maplibregl-canvas').focus()
  for (let i = 0; i < 4; i++) await map.page().keyboard.press('ArrowRight')
  await expect.poll(() => offCentre(map), { timeout: 10_000 }).toBeGreaterThan(80)
}

const background = (el: Locator) => el.evaluate((b) => getComputedStyle(b).backgroundColor)

/**
 * The button stays solid under the pointer, light and dark (MapLibre's own control hover is a 5% black wash that used
 * to win over its white, leaving it nearly see-through over the map). Dark mode is the root's `dark` class.
 */
export async function expectSolidHover(map: Locator): Promise<void> {
  const button = locateButton(map)
  await expect(button).toBeVisible({ timeout: 20_000 })
  const page = map.page()
  for (const [dark, rest, hover] of [
    [false, 'rgb(255, 255, 255)', 'rgb(255, 241, 232)'],
    [true, 'rgb(34, 43, 46)', 'rgb(46, 58, 62)'],
  ] as const) {
    await page.evaluate((on) => {
      document.documentElement.classList.toggle('dark', on)
      document.documentElement.classList.toggle('light', !on)
    }, dark)
    await page.mouse.move(0, 0)
    await expect.poll(() => background(button)).toBe(rest)
    await button.hover()
    await expect.poll(() => background(button)).toBe(hover)
  }
}
