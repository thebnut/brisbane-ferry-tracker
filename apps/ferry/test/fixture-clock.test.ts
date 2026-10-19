// @vitest-environment node
/** `?fixtureNow=` pins the fixtures' clock in fixture mode only; with fixture mode off (production) it does nothing. */
import { fileURLToPath } from 'node:url'
import { RouterContextProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { unstable_readConfig } from 'wrangler'
import { cloudflareContext } from '../app/lib/context.ts'
import { loaderEnv } from '../app/lib/server.server.ts'

const PINNED = 1792504800000 // 08:00 AEST, Tue 20 Oct 2026
const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))

function setup(vars: Record<string, unknown>, query: string, cookie?: string) {
  const api = vi.fn(async (_req: Request) => Response.json({ from: 'api' }))
  const env = { ...vars, API: { fetch: api } } as unknown as Env
  const context = new RouterContextProvider()
  context.set(cloudflareContext, { env, ctx: {} as ExecutionContext, nonce: 'n' })
  const headers: Record<string, string> = cookie ? { cookie } : {}
  return { api, ...loaderEnv(new Request(`https://x/${query}`, { headers }), context) }
}

describe('fixtureNow', () => {
  it('pins the fixture data to the given instant in fixture mode', async () => {
    const s = setup({ ALLOW_FIXTURES: '1', FIXTURES: '0' }, `?fixtures=1&fixtureNow=${PINNED}`)
    expect(s.fixtures).toBe(true)
    const body = (await (await s.fetcher('/v1/alerts')).json()) as { generatedAt: number }
    expect(body.generatedAt).toBe(PINNED)
    expect(s.api).not.toHaveBeenCalled()
  })

  it('pins it however fixture mode is on: FIXTURES="1", or ALLOW_FIXTURES with the cookie', async () => {
    for (const s of [
      setup({ FIXTURES: '1' }, `?fixtureNow=${PINNED}`),
      setup({ ALLOW_FIXTURES: '1', FIXTURES: '0' }, `?fixtureNow=${PINNED}`, 'bft_fixtures=1'),
    ]) {
      expect(s.fixtures).toBe(true)
      expect(((await (await s.fetcher('/v1/alerts')).json()) as { generatedAt: number }).generatedAt).toBe(
        PINNED,
      )
    }
  })

  it('a malformed value is the real clock', async () => {
    const before = Date.now()
    const s = setup({ FIXTURES: '1' }, '?fixtureNow=1e12')
    const at = ((await (await s.fetcher('/v1/alerts')).json()) as { generatedAt: number }).generatedAt
    expect(at).toBeGreaterThanOrEqual(before)
  })

  it('is ignored when fixture mode is off: the API answers, and the parameter never reaches it', async () => {
    for (const vars of [{ ALLOW_FIXTURES: '0', FIXTURES: '0' }, {}]) {
      const s = setup(vars, `?fixtures=1&fixtureNow=${PINNED}`, 'bft_fixtures=1')
      expect(s.fixtures).toBe(false)
      expect(await (await s.fetcher('/v1/alerts')).json()).toEqual({ from: 'api' })
      expect(s.api.mock.calls.map(([r]) => new URL(r.url).search)).toEqual([''])
    }
  })

  it('changes nothing on a Worker with the production config', async () => {
    const vars = unstable_readConfig({ config: CONFIG, env: 'production' }, { hideWarnings: true }).vars
    const s = setup(vars, `?fixtures=1&fixtureNow=${PINNED}`, 'bft_fixtures=1')
    expect(s.fixtures).toBe(false)
    expect(await (await s.fetcher('/v1/alerts')).json()).toEqual({ from: 'api' })
    expect(s.api).toHaveBeenCalledTimes(1)
  })
})
