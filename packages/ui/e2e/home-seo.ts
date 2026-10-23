/**
 * THE-118 PR 8: the mode homes (/ferry, /train, /bus, and each standalone site's /) moved to one skeleton. Their title,
 * meta, canonical and JSON-LD stay exactly as on develop before it (a golden copy, seo-head.ts), and their SEO copy is
 * still in the server HTML, now closed under "About … times" (a `<details>` without `open`).
 */
import { expect, test } from '@playwright/test'
import { seoHead } from './seo-head.ts'

export function homeSeoSuite({
  golden,
  homes,
}: {
  /**
   * The golden copy, read and written by the spec (this package has no Node types). With `write` set (the spec's
   * `WRITE_SEO_GOLDEN=1`), the suite writes it again instead of comparing, from develop before PR 8.
   */
  golden: { read: () => Record<string, string[]>; write?: (got: Record<string, string[]>) => void }
  /** Each home's path, the About summary and a phrase of its SEO copy. */
  homes: Array<{ path: string; about: string; copy: string }>
}) {
  test('the mode homes keep their SEO head', async ({ request }) => {
    test.skip(test.info().project.name !== 'phone', 'server HTML: once')
    const got: Record<string, string[]> = {}
    for (const { path } of homes) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(200)
      got[path] = seoHead(await res.text())
    }
    if (golden.write) return golden.write(got)
    const want = golden.read()
    // One assertion per page, so a failure names it.
    for (const { path } of homes) expect(got[path], path).toEqual(want[path])
  })

  test('the SEO copy is in the server HTML, closed under About', async ({ request }) => {
    test.skip(test.info().project.name !== 'phone', 'server HTML: once')
    test.skip(golden.write != null, 'develop has no About section')
    for (const { path, about, copy } of homes) {
      const html = await (await request.get(path)).text()
      const details = /<details\b([^>]*)>([\s\S]*?)<\/details>/.exec(html)
      expect(details, path).not.toBeNull()
      expect(details?.[1], path).not.toMatch(/\bopen\b/)
      expect(details?.[2], path).toContain(about)
      expect(details?.[2], path).toContain(copy)
    }
  })
}
