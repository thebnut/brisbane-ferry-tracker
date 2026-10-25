/**
 * Production config guard (docs/architecture/cutover-runbook.md, "Train, bus and transit production"): only the
 * "production" env binds the real domains, nothing in production serves fixtures or demo data, and
 * "production-preview" is the same Worker minus its domains.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unstable_readConfig } from 'wrangler'

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const APEX = 'brisbanebus.com'
const read = (env?: string) => unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true })

describe('wrangler.jsonc production envs', () => {
  const prod = read('production')
  const preview = read('production-preview')

  it('production binds exactly the apex and www as custom domains, and nothing else does', () => {
    expect(prod.name).toBe('bft-bus-prod')
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

describe('deploy scripts stamp the deployed commit (x-bft-build)', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .scripts as Record<string, string>
  const deploys = Object.entries(scripts).filter(([name]) => name.startsWith('deploy:'))

  it('every deploy:* script computes the sha before building and passes it to wrangler as BUILD_SHA', () => {
    expect(deploys.map(([name]) => name)).toEqual(
      expect.arrayContaining(['deploy:staging', 'deploy:production']),
    )
    for (const [name, cmd] of deploys) {
      const env = name.slice('deploy:'.length)
      expect(cmd, name).toBe(
        `BUILD_SHA=$(node ../../scripts/build-sha.mjs) && CLOUDFLARE_ENV=${env} pnpm build && wrangler deploy --var BUILD_SHA:$BUILD_SHA`,
      )
    }
  })

  it('no env hardcodes BUILD_SHA (unset locally and in tests: "dev")', () => {
    for (const env of [undefined, ...deploys.map(([name]) => name.slice('deploy:'.length))])
      expect(read(env).vars, String(env)).not.toHaveProperty('BUILD_SHA')
  })
})

describe('GA4 (@bft/ui/analytics-config): on where deployed, off locally and in tests', () => {
  it('the one property in production and staging; debug_mode only on staging', () => {
    for (const env of ['production', 'production-preview', 'staging']) {
      const vars = read(env).vars as Record<string, unknown>
      expect(vars.GA_MEASUREMENT_ID, env).toBe('G-MEG3CX0SFC')
      expect(vars.GA_DEBUG, env).toBe(env === 'staging' ? '1' : undefined)
    }
  })

  it('unset locally (dev, fixtures, e2e): no tag, no Google origin, no request to Google', () => {
    expect(read().vars).not.toHaveProperty('GA_MEASUREMENT_ID')
    expect(read().vars).not.toHaveProperty('GA_DEBUG')
  })
})
