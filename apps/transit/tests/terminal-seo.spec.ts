/**
 * THE-118 PR 5: Ferry became a terminal board (one board with a "To" filter, `?to=` in the terminal URL). The
 * terminal pages' and ferry home's title, meta, canonical and JSON-LD stay exactly as on develop before it (golden copy
 * in terminal-seo.golden.json; @bft/ui/e2e/seo-head.ts), including with `?to=`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seoHeads } from '@bft/ui/e2e/seo-head.ts'
import { expect, test } from '@playwright/test'

/** Taken from develop at 88ddb2c (`WRITE_SEO_GOLDEN=1` writes it again). */
const GOLDEN = fileURLToPath(new URL('./terminal-seo.golden.json', import.meta.url))
const golden = () => JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string[]>
/** Every terminal's page, and ferry home. */
const SLUGS = (
  JSON.parse(readFileSync(new URL('../../ferry/app/data/terminals.json', import.meta.url), 'utf8')) as Array<{
    slug: string
  }>
).map((t) => t.slug)
const PATHS = ['/ferry', ...SLUGS.map((s) => `/ferry/terminal/${s}`)]

test('terminal pages and ferry home keep their SEO head', async ({ request }) => {
  test.skip(test.info().project.name !== 'phone', 'server HTML: once')
  const got = await seoHeads(request, PATHS)
  if (process.env.WRITE_SEO_GOLDEN === '1') return writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`)
  const want = golden()
  // One assertion per page, so a failure names it.
  for (const path of PATHS) expect(got[path], path).toEqual(want[path])
})

test('a terminal page with "To" set keeps the terminal page\'s SEO head', async ({ request }) => {
  test.skip(test.info().project.name !== 'phone', 'server HTML: once')
  test.skip(process.env.WRITE_SEO_GOLDEN === '1', 'compares with the golden copy')
  const pairs: Array<[path: string, without: string]> = [
    ['/ferry/terminal/bulimba?to=riverside', '/ferry/terminal/bulimba'],
    ['/ferry/terminal/bulimba?to=teneriffe', '/ferry/terminal/bulimba'],
    ['/ferry/terminal/sydney-street?to=dockside', '/ferry/terminal/sydney-street'],
  ]
  const got = await seoHeads(
    request,
    pairs.map(([p]) => p),
  )
  const want = golden()
  for (const [path, without] of pairs) expect(got[path], path).toEqual(want[without])
})
