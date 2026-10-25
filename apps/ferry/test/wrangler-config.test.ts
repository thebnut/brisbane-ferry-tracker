/**
 * Turnstile sitekey per env (docs/architecture/cutover-runbook.md section 9). Two widgets: "bft-transit-ask"
 * (STAGING, whose secret is on bft-api) and "bft-transit-prod" (PROD, secret on bft-api-prod). The relay verifies
 * through the env's API binding, so each env must ship the sitekey of the widget that API holds the secret for.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unstable_readConfig } from 'wrangler'

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const STAGING_SITEKEY = '0x4AAAAAAFZ6yPZTYH3xrIMT'
const PROD_SITEKEY = '0x4AAAAAAFan8LE5_4cvR40S'
const TEST_SITEKEY = '1x00000000000000000000AA'
const read = (env?: string) => unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true })

describe('wrangler.jsonc Turnstile sitekeys', () => {
  it('staging uses the STAGING widget and verifies through bft-api', () => {
    const c = read('staging')
    expect(c.vars.TURNSTILE_SITEKEY).toBe(STAGING_SITEKEY)
    expect(c.services).toEqual([{ binding: 'API', service: 'bft-api' }])
  })

  it('production uses the PROD widget and verifies through bft-api-prod', () => {
    const c = read('production')
    expect(c.vars.TURNSTILE_SITEKEY).toBe(PROD_SITEKEY)
    expect(c.services).toEqual([{ binding: 'API', service: 'bft-api-prod' }])
  })

  it('local dev uses the STAGING widget too, and no env ships the test key', () => {
    expect(read().vars.TURNSTILE_SITEKEY).toBe(STAGING_SITEKEY)
    for (const env of [undefined, 'staging', 'production'])
      expect(read(env).vars.TURNSTILE_SITEKEY, String(env)).not.toBe(TEST_SITEKEY)
  })
})

describe('demo data never reaches production, and staging shows real data (R7-B1)', () => {
  it('production envs serve no fixtures: FIXTURES and ALLOW_FIXTURES are "0" (or unset), no FIXTURE_FALLBACK', () => {
    for (const env of ['production']) {
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
    for (const env of ['production', 'staging']) {
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
