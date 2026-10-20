/**
 * Every loader with live data marks its answer as a network one (`via: VIA_NETWORK`, next to `renderedAt`), across
 * the transit pages and the mode apps' pages it mounts: without it, stampNavigation keeps a client navigation's live
 * data as an offline copy (R15-S1, Codex r1).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APPS = join(import.meta.dirname, '..', '..')
const routes = ['transit', 'ferry', 'train', 'bus'].flatMap((app) => {
  const dir = join(APPS, app, 'app', 'routes')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ name: `${app}/${f}`, source: readFileSync(join(dir, f), 'utf8') }))
})

describe('loaders with live data say they came from the network', () => {
  it('finds the route modules', () => expect(routes.length).toBeGreaterThan(20))
  for (const { name, source } of routes.filter((r) => r.source.includes('renderedAt: Date.now()'))) {
    it(name, () => {
      const renders = source.match(/renderedAt: Date\.now\(\)/g) ?? []
      const marked = source.match(/renderedAt: Date\.now\(\),\s*via: VIA_NETWORK/g) ?? []
      expect(marked.length).toBe(renders.length)
    })
  }
})
