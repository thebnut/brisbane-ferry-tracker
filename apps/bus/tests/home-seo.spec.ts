/** THE-118 PR 8: the home keeps its SEO (@bft/ui/e2e/home-seo.ts). */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homeSeoSuite } from '@bft/ui/e2e/home-seo.ts'

/** Taken from develop at 83ef30c (`WRITE_SEO_GOLDEN=1` writes it again). */
const GOLDEN = fileURLToPath(new URL('./home-seo.golden.json', import.meta.url))

homeSeoSuite({
  golden: {
    read: () => JSON.parse(readFileSync(GOLDEN, 'utf8')),
    write:
      process.env.WRITE_SEO_GOLDEN === '1'
        ? (got) => writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`)
        : undefined,
  },
  homes: [{ path: '/', about: 'About bus times', copy: 'Live departures for every Brisbane bus stop' }],
})
