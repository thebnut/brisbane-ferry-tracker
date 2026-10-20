/**
 * The phone Mode Tabs (My Transit | Nearby | Ferry | Train | Bus) fit at 390 and 360 px: every label fully visible on
 * one line (inside its tab, every clipping ancestor and the viewport), no horizontal scroll, tap targets at least 44 px.
 */
import { expect, type Locator, test } from '@playwright/test'

interface Fit {
  name: string
  width: number
  height: number
  lines: number
  clipped: boolean
}

const measure = (links: Locator): Promise<Fit[]> =>
  links.evaluateAll((els) =>
    els.map((a) => {
      const box = a.getBoundingClientRect()
      // The label is the link's text node, after the icon.
      const text = [...a.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      const range = document.createRange()
      if (text) range.selectNodeContents(text)
      const label = text ? range.getBoundingClientRect() : null
      const within = (r: DOMRect | { left: number; right: number; top: number; bottom: number }) =>
        !!label &&
        label.left >= r.left - 0.5 &&
        label.right <= r.right + 0.5 &&
        label.top >= r.top - 0.5 &&
        label.bottom <= r.bottom + 0.5
      // Inside the tab, the viewport, and every ancestor that clips its overflow.
      let ok =
        within(box) && within({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })
      for (let el = a.parentElement; ok && el; el = el.parentElement) {
        const s = getComputedStyle(el)
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') ok = within(el.getBoundingClientRect())
      }
      return {
        name: a.textContent?.trim() ?? '',
        width: box.width,
        height: box.height,
        lines: text ? range.getClientRects().length : 0,
        clipped: !ok,
      }
    }),
  )

const fits = (r: Fit) => r.lines === 1 && !r.clipped && r.width >= 44 && r.height >= 44

for (const width of [390, 360]) {
  test(`Mode Tabs fit at ${width} px`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the bottom Mode Tabs are phone-only')
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const links = page.getByRole('navigation', { name: 'Modes' }).filter({ visible: true }).getByRole('link')
    expect((await links.allInnerTexts()).map((t) => t.trim())).toEqual([
      'My Transit',
      'Nearby',
      'Ferry',
      'Train',
      'Bus',
    ])
    for (const r of await measure(links)) {
      expect(r.lines, `${r.name} on one line`).toBe(1)
      expect(r.clipped, `${r.name} fully visible`).toBe(false)
      expect(r.width, `${r.name} tap width`).toBeGreaterThanOrEqual(44)
      expect(r.height, `${r.name} tap height`).toBeGreaterThanOrEqual(44)
    }
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(scroll).toBeLessThanOrEqual(0)

    // The check itself catches a label that is clipped or wrapped.
    await page.addStyleTag({ content: 'nav[aria-label="Modes"] ul { height: 24px; overflow: hidden }' })
    expect((await measure(links)).some((r) => r.clipped && !fits(r))).toBe(true)
    await page.addStyleTag({
      content:
        'nav[aria-label="Modes"] ul { height: auto; overflow: visible } nav[aria-label="Modes"] a { width: 30px; margin: auto }',
    })
    expect((await measure(links)).some((r) => r.lines > 1 && !fits(r))).toBe(true)
  })
}
