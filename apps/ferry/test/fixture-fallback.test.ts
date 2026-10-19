/**
 * R7-B1: demo data only where it is allowed. FIXTURE_FALLBACK counts only with ALLOW_FIXTURES, and even then never
 * for an SSR call cut off by its time budget (a slow API showed "Demo data" on staging), nor in the proxy.
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { fixtureFallbackOn, loaderEnv, settle } from '../app/lib/server.server.ts'
import { proxyApi } from '../workers/app.ts'

const PATH = '/v1/alerts'

function envWith(vars: Record<string, string>, api: (req: Request) => Promise<Response>) {
  return { API_BASE: 'https://api.test', FIXTURES: '0', ...vars, API: { fetch: api } } as unknown as Env
}
function ctx(env: Env) {
  const c = new RouterContextProvider()
  c.set(cloudflareContext, { env, ctx: {} as ExecutionContext, nonce: 'n' })
  return c
}
const failing = async () => {
  throw new TypeError('network down')
}
/** An API that answers only once the caller gives up. */
const hanging = (req: Request) =>
  new Promise<Response>((_, reject) =>
    req.signal.addEventListener('abort', () => reject(new Error('aborted'))),
  )

describe('FIXTURE_FALLBACK guard (R7-B1)', () => {
  it('is on only together with ALLOW_FIXTURES', () => {
    expect(fixtureFallbackOn({ ALLOW_FIXTURES: '1', FIXTURE_FALLBACK: '1' })).toBe(true)
    expect(fixtureFallbackOn({ ALLOW_FIXTURES: '0', FIXTURE_FALLBACK: '1' })).toBe(false)
    expect(fixtureFallbackOn({ FIXTURE_FALLBACK: '1' })).toBe(false)
    expect(fixtureFallbackOn({ ALLOW_FIXTURES: '1' })).toBe(false)
    expect(fixtureFallbackOn(null)).toBe(false)
  })

  it('the proxy answers an API failure with its error, not fixtures, unless fixtures are allowed', async () => {
    const req = new Request(`https://app.test${PATH}`)
    const strict = await proxyApi(req, envWith({ ALLOW_FIXTURES: '0', FIXTURE_FALLBACK: '1' }, failing))
    expect(strict.status).toBe(502)
    const dev = await proxyApi(req, envWith({ ALLOW_FIXTURES: '1', FIXTURE_FALLBACK: '1' }, failing))
    expect(dev.status).toBe(200)
  })

  it('SSR: a call cut off by its time budget is no answer, never demo data', async () => {
    vi.useFakeTimers()
    const env = envWith({ ALLOW_FIXTURES: '1', FIXTURE_FALLBACK: '1' }, hanging)
    const { fetcher } = loaderEnv(new Request('https://app.test/'), ctx(env))
    const p = settle((signal) => fetcher(PATH, { signal }))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await p).toBeNull()
    vi.useRealTimers()
  })

  it('SSR: with fixtures not allowed, an API error stays an error', async () => {
    const env = envWith({ ALLOW_FIXTURES: '0', FIXTURE_FALLBACK: '1' }, failing)
    const { fetcher } = loaderEnv(new Request('https://app.test/'), ctx(env))
    await expect(fetcher(PATH)).rejects.toThrow()
  })
})

describe('proxy deadline (R8-F1)', () => {
  it('an API that never answers gets a 502 at the deadline, and the API sees the abort', async () => {
    vi.useFakeTimers()
    const { API_TIMEOUT_MS } = await import('@bft/ui/upstream')
    let upstream: Request | undefined
    const env = envWith({ ALLOW_FIXTURES: '0' }, (req) => {
      upstream = req
      return hanging(req)
    })
    const res = proxyApi(new Request('https://app.test/v1/ferry/stops/317584/departures?to=317590'), env)
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    expect((await res).status).toBe(502)
    expect(upstream?.signal.aborted).toBe(true)
    vi.useRealTimers()
  })
})
