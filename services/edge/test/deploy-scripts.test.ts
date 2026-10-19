/** The deploy scripts stamp the deployed commit: x-bft-build and /v1/health's build (scripts/build-sha.mjs). */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  .scripts as Record<string, string>

describe('bft-api deploy scripts', () => {
  it('deploy:staging and deploy:production pass the sha of the checkout as BUILD_SHA', () => {
    for (const env of ['staging', 'production'])
      expect(scripts[`deploy:${env}`], env).toBe(
        `BUILD_SHA=$(node ../../scripts/build-sha.mjs) && wrangler deploy --env ${env} --var BUILD_SHA:$BUILD_SHA`,
      )
  })

  it('every script that deploys this Worker stamps it', () => {
    for (const [name, cmd] of Object.entries(scripts))
      if (/\bwrangler deploy\b/.test(cmd)) expect(cmd, name).toContain('--var BUILD_SHA:$BUILD_SHA')
  })
})
