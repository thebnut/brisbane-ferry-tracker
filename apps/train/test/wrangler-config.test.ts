/**
 * Production config guard (docs/architecture/cutover-runbook.md, "Train, bus and transit production"): only the
 * "production" env binds the real domains, nothing in production serves fixtures or demo data, and
 * "production-preview" is the same Worker minus its domains.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unstable_readConfig } from 'wrangler'

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const APEX = 'brisbanetrain.com'
const read = (env?: string) => unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true })

describe('wrangler.jsonc production envs', () => {
  const prod = read('production')
  const preview = read('production-preview')

  it('production binds exactly the apex and www as custom domains, and nothing else does', () => {
    expect(prod.name).toBe('bft-train-prod')
    expect(prod.workers_dev).toBe(false)
    expect(prod.routes).toEqual([
      { pattern: APEX, custom_domain: true },
      { pattern: `www.${APEX}`, custom_domain: true },
    ])
    for (const env of [undefined, 'staging', 'production-preview'])
      expect(read(env).routes ?? [], String(env)).toEqual([])
  })

  it('production reads bft-api-prod and never serves fixtures or demo data', () => {
    for (const c of [prod, preview]) {
      expect(c.services).toEqual([{ binding: 'API', service: 'bft-api-prod' }])
      expect(c.vars).toMatchObject({
        API_BASE: 'https://api.brisbaneferry.com',
        ALLOW_FIXTURES: '0',
        FIXTURES: '0',
        SITE_URL: `https://${APEX}`,
      })
      expect(c.vars).not.toHaveProperty('FIXTURE_FALLBACK')
      expect(['0', '1']).toContain(c.vars.INDEXABLE)
    }
  })

  it('production-preview is production on workers.dev only', () => {
    expect(preview.name).toBe(prod.name)
    expect(preview.workers_dev).toBe(true)
    expect(preview.vars).toEqual(prod.vars)
    expect(preview.services).toEqual(prod.services)
    expect(preview.durable_objects).toEqual(prod.durable_objects)
    expect(preview.migrations).toEqual(prod.migrations)
  })

  it('the WebSocket trip prototype starts off in production', () => {
    expect(prod.vars.TRIP_WS).toBe('0')
    expect(prod.durable_objects.bindings).toEqual([{ name: 'TRIP_SOCKET', class_name: 'TripSocket' }])
  })
})
