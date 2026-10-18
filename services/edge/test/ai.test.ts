/**
 * Phase 8: /v1/ask (deterministic path, kill switch, budget gating, grounding) and the read-only /mcp server.
 * No provider calls are made: the LLM path is exercised with AI disabled or a stubbed fetch.
 */
import { DEFAULT_BUDGET, emptyBudgetState, reserve } from '@bft/core'
import { describe, expect, it, vi } from 'vitest'
import { budgetConfig, intentFromPlan, ipKey, registerAi } from '../src/ai/routes.ts'
import { createApp } from '../src/app.ts'
import { silentLogger } from '../src/log.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import { Clock, D, buildTree, epoch, storeFor } from './fixtures.ts'

const NAMES: Record<string, string> = {
  '317584': 'Bulimba ferry terminal',
  '317590': 'Riverside ferry terminal',
  '317586': 'Hawthorne ferry terminal',
}

function setup(env: Record<string, unknown> = {}) {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  vi.setSystemTime(clock.t)
  const tree = buildTree()
  // Real-looking names so the fuzzy resolver has something to match.
  const stops = ['317584', '317590', '317586', 'QUIET'].map((key) => ({
    key,
    name: NAMES[key] ?? key,
    lat: -27.4,
    lon: 153,
    routes: [],
  }))
  tree.source.files.set(
    'data/ferry/stops.json',
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, mode: 'ferry', generation: 'g1', stops })),
  )
  const store = storeFor(tree, clock.now)
  const snapshots = new SnapshotClient(
    { pull: async () => null as never, getRaw: async () => null },
    clock.now,
    () => {},
    null,
  )
  const app = createApp({
    store,
    snapshots,
    now: clock.now,
    log: silentLogger,
    combinedFeeds: false,
    polledModes: ['ferry'],
  })
  registerAi(app, { store, generationKey: async () => 'g1' }, () => env)
  const ask = (question: string, headers: Record<string, string> = {}) =>
    app.request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
      headers: { 'content-type': 'application/json', ...headers },
    })
  const rpc = (body: unknown) =>
    app.request('/mcp', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  return { app, ask, rpc }
}

describe('POST /v1/ask', () => {
  it('answers a "from X to Y" question deterministically from live data, with no LLM', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const s = setup()
    const res = await s.ask('when is the next ferry from bulimba to riverside?')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      source: string
      answer: string
      departures: Array<{ route: string }>
    }
    expect(body.source).toBe('deterministic')
    expect(body.answer).toMatch(/^Next ferrys? from Bulimba ferry terminal to Riverside ferry terminal: /)
    expect(body.departures.length).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('serves the second identical question from the intent cache (answer recomputed)', async () => {
    const s = setup()
    await s.ask('departures at bulimba ferry')
    const body = (await (await s.ask('Departures at Bulimba ferry!')).json()) as { source: string }
    expect(body.source).toBe('cache')
  })

  it('kill switch off by default: unparseable questions get a deterministic hint, never the provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const s = setup()
    const body = (await (await s.ask('can I take my bike on the ferry')).json()) as {
      source: string
      ai: { enabled: boolean }
    }
    expect(body.source).toBe('fallback')
    expect(body.ai.enabled).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('AI enabled but no Turnstile secret: refuses the LLM path', async () => {
    const s = setup({ AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'x', AI_MONTHLY_BUDGET_USD: '10', BUDGET: {} })
    const body = (await (await s.ask('can I take my bike on the ferry')).json()) as { ai: { reason: string } }
    expect(body.ai.reason).toBe('turnstile_not_configured')
  })

  it('validates input', async () => {
    const s = setup()
    const res = await s.app.request('/v1/ask', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('the rate limiter answers 429', async () => {
    const s = setup({ ASK_LIMITER: { limit: async () => ({ success: false }) } })
    expect((await s.ask('departures at bulimba')).status).toBe(429)
  })
})

describe('budget config', () => {
  it('is disabled unless AI_ENABLED, a key and the Budget DO are all present', () => {
    expect(budgetConfig({}).enabled).toBe(false)
    expect(budgetConfig({ AI_ENABLED: 'true' }).enabled).toBe(false)
    expect(
      budgetConfig({
        AI_ENABLED: 'true',
        ANTHROPIC_API_KEY: 'k',
        BUDGET: {} as never,
        AI_MONTHLY_BUDGET_USD: '10',
      }),
    ).toMatchObject({
      enabled: true,
      monthlyBudgetUsd: 10,
    })
  })
  it('a $10 cap stops reservations at $10 including in-flight ones', () => {
    const cfg = { ...DEFAULT_BUDGET, enabled: true, monthlyBudgetUsd: 10 }
    let s = emptyBudgetState('20261018')
    let ok = 0
    for (let i = 0; i < 10_000; i++) {
      const r = reserve(s, cfg, `r${i}`, 0.0035, null, false, 0)
      s = r.state
      if (r.result.ok) ok++
    }
    expect(ok * 0.0035).toBeLessThanOrEqual(10)
    expect(ok).toBe(2857)
  })
})

describe('helpers', () => {
  it('hashes IP prefixes, not addresses', async () => {
    expect(await ipKey('1.2.3.4', 's')).toBe(await ipKey('1.2.3.99', 's'))
    expect(await ipKey('1.2.4.4', 's')).not.toBe(await ipKey('1.2.3.4', 's'))
    expect(await ipKey(null, 's')).toBeNull()
  })
  it('learns a single get_departures plan as an intent', () => {
    expect(
      intentFromPlan([
        {
          tool: 'get_departures',
          ok: true,
          input: { mode: 'ferry', stopKey: '317584', toKey: '317590' },
          result: { stop: 'Bulimba', to: 'Riverside' },
        },
      ]),
    ).toMatchObject({ kind: 'next_departure', from: { key: '317584' }, to: { key: '317590' } })
    expect(intentFromPlan([])).toBeNull()
  })
})

describe('/mcp (read-only)', () => {
  it('initialize, tools/list and tools/call', async () => {
    const s = setup()
    const init = (await (
      await s.rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    ).json()) as { result: { serverInfo: { name: string } } }
    expect(init.result.serverInfo.name).toBe('brisbane-transit')
    const list = (await (await s.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as {
      result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }
    }
    expect(list.result.tools.map((t) => t.name)).toEqual([
      'search_stops',
      'get_departures',
      'get_trip',
      'get_alerts',
    ])
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true)
    const call = (await (
      await s.rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_departures',
          arguments: { mode: 'ferry', stopKey: '317584', toKey: '317590', limit: 2 },
        },
      })
    ).json()) as { result: { content: Array<{ text: string }>; isError: boolean } }
    expect(call.result.isError).toBe(false)
    expect(JSON.parse(call.result.content[0]?.text ?? '{}').departures.length).toBeGreaterThan(0)
    const search = (await (
      await s.rpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'search_stops', arguments: { query: 'riversde' } },
      })
    ).json()) as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(search.result.content[0]?.text ?? '[]')[0].key).toBe('317590')
  })
  it('unknown methods and tools are JSON-RPC errors', async () => {
    const s = setup()
    expect(
      (
        (await (await s.rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).json()) as {
          error: { code: number }
        }
      ).error.code,
    ).toBe(-32601)
    expect(
      (
        (await (
          await s.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'rm' } })
        ).json()) as { error: { code: number } }
      ).error.code,
    ).toBe(-32602)
  })
})
