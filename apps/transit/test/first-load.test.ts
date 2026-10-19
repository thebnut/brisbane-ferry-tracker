/** The first-load budget's normalisation (tests/first-load.ts): only per-request noise is made constant. */
import { describe, expect, it } from 'vitest'
import { stableInline } from '../tests/first-load.ts'

const PINNED = 1792504800000
const RENDERED = 1800000000000
const page = (nonce: string, rendered: number, data: string) =>
  `<script nonce="${nonce}">window.__bftRenderedAt=${rendered};x</script><script src="/assets/a.js"></script>` +
  `<script nonce="${nonce}">{"n":"${nonce}","renderedAt":${rendered + 3},"data":${data}}</script>`

describe('stableInline', () => {
  it('two requests that differ only in nonce and render time normalise to the same text', () => {
    const a = stableInline(
      page('AAAAAAAAAAAAAAAAAAAAAA==', RENDERED, '[1]'),
      'AAAAAAAAAAAAAAAAAAAAAA==',
      PINNED,
    )
    const b = stableInline(
      page('BBBBBBBBBBBBBBBBBBBBBB==', RENDERED + 61_000, '[1]'),
      'BBBBBBBBBBBBBBBBBBBBBB==',
      PINNED,
    )
    expect(a).toBe(b)
    expect(a).toContain(`__bftRenderedAt=${PINNED + 1_234}`)
    expect(a).toContain(`"renderedAt":${PINNED + 1_237}`)
    expect(a).not.toContain('AAAA')
  })

  it('leaves every other timestamp, and all other content, as it is', () => {
    const data = `[${PINNED},${PINNED + 3_600_000},${RENDERED - 6_000},${RENDERED + 6_000},1234567890123]`
    const out = stableInline(page('n0nce', RENDERED, data), 'n0nce', PINNED)
    expect(out).toContain(`"data":${data}`)
    expect(out).not.toContain('/assets/a.js')
  })

  it("render times never collide with the fixtures' timestamps (generatedAt is the pinned instant)", () => {
    const out = stableInline(page('n0nce', RENDERED, `{"generatedAt":${PINNED}}`), 'n0nce', PINNED)
    const rendered = [...out.matchAll(/__bftRenderedAt=(\d{13})|"renderedAt":(\d{13})/g)].map((m) =>
      Number(m[1] ?? m[2]),
    )
    expect(rendered).toHaveLength(2)
    for (const r of rendered) expect(r).not.toBe(PINNED)
    expect(out).toContain(`"generatedAt":${PINNED}`)
  })

  it('keeps the inline length, so the gzip size reflects the real content', () => {
    const html = page('CCCCCCCCCCCCCCCCCCCCCC==', RENDERED, '["x"]')
    const raw = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .join('')
    expect(stableInline(html, 'CCCCCCCCCCCCCCCCCCCCCC==', PINNED)).toHaveLength(raw.length)
  })
})
