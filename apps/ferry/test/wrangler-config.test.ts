/**
 * Turnstile sitekey per env (docs/architecture/cutover-runbook.md section 9). Two widgets: "bft-transit-ask"
 * (STAGING, whose secret is on bft-api) and "bft-transit-prod" (PROD, secret on bft-api-prod). The relay verifies
 * through the env's API binding, so each env must ship the sitekey of the widget that API holds the secret for.
 */
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

  it('local dev has no sitekey (localhost is on neither widget), and no env ships the test key', () => {
    expect(read().vars).not.toHaveProperty('TURNSTILE_SITEKEY')
    for (const env of [undefined, 'staging', 'production'])
      expect(read(env).vars.TURNSTILE_SITEKEY, String(env)).not.toBe(TEST_SITEKEY)
  })
})
