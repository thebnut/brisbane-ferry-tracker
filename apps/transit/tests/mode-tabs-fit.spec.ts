/**
 * The phone Mode Tabs (My Transit | Nearby | Ferry | Train | Bus) fit at 390 and 360 px: every label fully visible on
 * one line inside its tab, no horizontal scroll, tap targets at least 44 px.
 */
import { expect, test } from '@playwright/test'

for (const width of [390, 360]) {
  test(`Mode Tabs fit at ${width} px`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the bottom Mode Tabs are phone-only')
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Modes' }).filter({ visible: true })
    const links = nav.getByRole('link')
    expect((await links.allInnerTexts()).map((t) => t.trim())).toEqual([
      'My Transit',
      'Nearby',
      'Ferry',
      'Train',
      'Bus',
    ])
    const report = await links.evaluateAll((els) =>
      els.map((a) => {
        const box = a.getBoundingClientRect()
        // The label is the link's text node, after the icon.
        const text = [...a.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
        const range = document.createRange()
        if (text) range.selectNodeContents(text)
        const rects = text ? [...range.getClientRects()] : []
        const label = text ? range.getBoundingClientRect() : null
        return {
          name: a.textContent?.trim(),
          width: box.width,
          height: box.height,
          lines: rects.length,
          inside: !!label && label.left >= box.left - 0.5 && label.right <= box.right + 0.5,
          inViewport: box.left >= 0 && box.right <= window.innerWidth,
        }
      }),
    )
    for (const r of report) {
      expect(r.lines, `${r.name} on one line`).toBe(1)
      expect(r.inside, `${r.name} label inside its tab`).toBe(true)
      expect(r.inViewport, `${r.name} inside the viewport`).toBe(true)
      expect(r.width, `${r.name} tap width`).toBeGreaterThanOrEqual(44)
      expect(r.height, `${r.name} tap height`).toBeGreaterThanOrEqual(44)
    }
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(scroll).toBeLessThanOrEqual(0)
  })
}
