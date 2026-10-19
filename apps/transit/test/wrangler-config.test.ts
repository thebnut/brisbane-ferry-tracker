/**
 * Production config guard (docs/architecture/cutover-runbook.md, "Train, bus and transit production"): only the
 * "production" env binds the real domains, nothing in production serves fixtures or demo data, and
 * "production-preview" is the same Worker minus its domains.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unstable_readConfig } from 'wrangler'

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const APEX = 'brisbanetransit.com'
// Public sitekeys: "bft-transit-ask" (STAGING, verified by bft-api) and "bft-transit-prod" (PROD, bft-api-prod).
const STAGING_SITEKEY = '0x4AAAAAAFZ6yPZTYH3xrIMT'
const PROD_SITEKEY = '0x4AAAAAAFan8LE5_4cvR40S'
const TEST_SITEKEY = '1x00000000000000000000AA'
const read = (env?: string) => unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true })

describe('wrangler.jsonc production envs', () => {
  const prod = read('production')
  const preview = read('production-preview')

  it('production binds exactly the apex and www as custom domains, and nothing else does', () => {
    expect(prod.name).toBe('bft-transit-prod')
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
    // Same limiter, but each env has its own namespace_id (test/feedback.test.ts).
    expect(preview.ratelimits.map(({ namespace_id: _, ...r }) => r)).toEqual(
      prod.ratelimits.map(({ namespace_id: _, ...r }) => r),
    )
  })

  it('mode pages point at the production sites and transit stays noindex', () => {
    expect(prod.vars).toMatchObject({
      FERRY_SITE_URL: 'https://www.brisbaneferry.com',
      TRAIN_SITE_URL: 'https://brisbanetrain.com',
      BUS_SITE_URL: 'https://brisbanebus.com',
      INDEXABLE: '0',
    })
  })

  // Two Turnstile widgets (runbook section 9). Each bft-api holds only its own widget's secret, so a sitekey that
  // doesn't match the API the env binds fails closed. production-preview's host is on neither widget (by design).
  it('staging and dev use the STAGING widget, both production envs the PROD widget, nowhere the test key', () => {
    for (const env of [undefined, 'staging']) {
      expect(read(env).vars.TURNSTILE_SITEKEY, String(env)).toBe(STAGING_SITEKEY)
      expect(read(env).services ?? [], String(env)).not.toContainEqual({
        binding: 'API',
        service: 'bft-api-prod',
      })
    }
    for (const c of [prod, preview]) expect(c.vars.TURNSTILE_SITEKEY).toBe(PROD_SITEKEY)
    for (const env of [undefined, 'staging', 'production-preview', 'production'])
      expect(read(env).vars.TURNSTILE_SITEKEY, String(env)).not.toBe(TEST_SITEKEY)
  })

  it('production keeps the /api/feedback limiter, in its own namespace', () => {
    expect(prod.ratelimits).toEqual([
      { name: 'FEEDBACK_LIMITER', namespace_id: '8106', simple: { limit: 3, period: 60 } },
    ])
    expect(preview.ratelimits).toEqual([
      { name: 'FEEDBACK_LIMITER', namespace_id: '8107', simple: { limit: 3, period: 60 } },
    ])
  })
})

describe('demo data never reaches production, and staging shows real data (R7-B1)', () => {
  it('production envs serve no fixtures: FIXTURES and ALLOW_FIXTURES are "0" (or unset), no FIXTURE_FALLBACK', () => {
    for (const env of ['production', 'production-preview']) {
      const vars = read(env).vars as Record<string, unknown>
      expect(vars.FIXTURES ?? '0', env).toBe('0')
      expect(vars.ALLOW_FIXTURES ?? '0', env).toBe('0')
      expect(vars, env).not.toHaveProperty('FIXTURE_FALLBACK')
    }
  })

  it('staging answers API failures with its error and offline states, never with fixtures', () => {
    const vars = read('staging').vars as Record<string, unknown>
    expect(vars.FIXTURES).toBe('0')
    expect(vars).not.toHaveProperty('FIXTURE_FALLBACK')
  })
})
