/** The mounted /api/feedback (apps/ferry/workers/legacy.ts): rate limited, titled "BrisbaneTransit", Discord secret. */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import worker from '../workers/app.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

const HOOK = 'https://discord.test/api/webhooks/0/test'

/** Every test starts with the network refused, so a regression can never reach a real host (Codex review). */
let fetchSpy: MockInstance<typeof fetch>
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in tests'))
})
afterEach(() => vi.restoreAllMocks())

const call = (env: Partial<Env>) =>
  worker.fetch(
    new Request('https://bft-transit.example/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
      body: JSON.stringify({ feedback: 'Feedback from the Ferry tab' }),
    }),
    { API_BASE: 'http://x', ...env } as Env,
    {} as ExecutionContext,
  )

describe('transit /api/feedback', () => {
  it('uses the FEEDBACK_LIMITER binding: limited is a 429 and nothing is sent', async () => {
    const spy = fetchSpy
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const limit = vi.fn(async () => ({ success: false }))
    const res = await call({ FEEDBACK_DISCORD_WEBHOOK_URL: HOOK, FEEDBACK_LIMITER: { limit } })
    expect(res.status).toBe(429)
    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.4' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('relays to the Discord secret with the BrisbaneTransit title', async () => {
    const spy = fetchSpy.mockResolvedValue(new Response('{}'))
    const res = await call({
      FEEDBACK_DISCORD_WEBHOOK_URL: HOOK,
      FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
    })
    expect(res.status).toBe(200)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${HOOK}?wait=true`)
    expect(JSON.parse(String(init.body)).embeds[0].title).toBe('Feedback: BrisbaneTransit')
  })
})

describe('FEEDBACK_LIMITER bindings in wrangler.jsonc', () => {
  // Full-line comments only in these files, so dropping them leaves plain JSON.
  const read = (path: string) =>
    JSON.parse(
      readFileSync(new URL(path, import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n'),
    ) as {
      ratelimits?: { name: string; namespace_id: string }[]
      env?: Record<string, { ratelimits?: { name: string; namespace_id: string }[] }>
    }
  const configs = {
    transit: read('../wrangler.jsonc'),
    ferry: read('../../ferry/wrangler.jsonc'),
    edge: read('../../../services/edge/wrangler.jsonc'),
  }

  it('every ferry and transit env binds it (bindings are not inherited)', () => {
    for (const app of ['transit', 'ferry'] as const) {
      const c = configs[app]
      for (const [name, rl] of [
        ['top', c.ratelimits],
        ...Object.entries(c.env ?? {}).map(([k, v]) => [k, v.ratelimits]),
      ])
        expect(
          (rl as { name: string }[] | undefined)?.some((r) => r.name === 'FEEDBACK_LIMITER'),
          `${app}:${name}`,
        ).toBe(true)
    }
    expect(configs.ferry.env?.production).toBeDefined()
  })

  it('namespace_ids are unique across the account (edge, ferry, transit)', () => {
    const ids = Object.values(configs).flatMap((c) => [
      ...(c.ratelimits ?? []),
      ...Object.values(c.env ?? {}).flatMap((e) => e.ratelimits ?? []),
    ])
    const byId = new Map<string, Set<string>>()
    for (const r of ids) byId.set(r.namespace_id, (byId.get(r.namespace_id) ?? new Set()).add(r.name))
    // A feedback limiter never shares an id with another limiter, and each env has its own.
    for (const [id, names] of byId)
      if (names.has('FEEDBACK_LIMITER')) expect(names, id).toEqual(new Set(['FEEDBACK_LIMITER']))
    const feedback = ids.filter((r) => r.name === 'FEEDBACK_LIMITER').map((r) => r.namespace_id)
    expect(new Set(feedback).size).toBe(feedback.length)
  })
})
