/** THE-118 PR 8: the Ferry, Train and Bus tabs' homes keep their SEO (@bft/ui/e2e/home-seo.ts). */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homeSeoSuite } from '@bft/ui/e2e/home-seo.ts'

/**
 * Taken from develop at 83ef30c, then rewritten on purpose for the SEO batch of 12 Nov 2026 (feat/seo-fixes): titles and
 * descriptions fitted to snippet length, Brisbane Transit as the site name and WebSite, its 1200×630 share card on
 * Train and Bus, and the deploy's noindex in the HTML (this server isn't production). `WRITE_SEO_GOLDEN=1` writes it
 * again.
 */
const GOLDEN = fileURLToPath(new URL('./home-seo.golden.json', import.meta.url))

homeSeoSuite({
  golden: {
    read: () => JSON.parse(readFileSync(GOLDEN, 'utf8')),
    write:
      process.env.WRITE_SEO_GOLDEN === '1'
        ? (got) => writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`)
        : undefined,
  },
  homes: [
    {
      path: '/ferry/',
      about: 'About ferry times',
      copy: 'Live departure boards for every Brisbane River ferry terminal',
    },
    {
      path: '/train/',
      about: 'About train times',
      copy: 'Live departure boards for every Queensland Rail City network station',
    },
    { path: '/bus/', about: 'About bus times', copy: 'Live departures for every Brisbane bus stop' },
  ],
})
