/**
 * Phase 8: /v1/ask (deterministic path, kill switch, budget gating, grounding) and the read-only /mcp server.
 * No provider calls are made: the LLM path is exercised with AI disabled or a stubbed fetch.
 */
import { type BudgetConfig, DEFAULT_BUDGET, emptyBudgetState, reconcile, reserve } from '@bft/core'
import { describe, expect, it, vi } from 'vitest'
import { budgetConfig, ipKey, ipv6Prefix48, registerAi } from '../src/ai/routes.ts'
import { createApp } from '../src/app.ts'
import { silentLogger } from '../src/log.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import { buildTree, Clock, D, epoch, storeFor } from './fixtures.ts'

const NAMES: Record<string, string> = {
  '317584': 'Bulimba ferry terminal',
  '317590': 'Riverside ferry terminal',
  '317586': 'Hawthorne ferry terminal',
}

function setup(env: Record<string, unknown> = {}, extra: { verifyTurnstile?: () => Promise<boolean> } = {}) {
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
  registerAi(app, { store, generationKey: async () => 'g1', ...extra }, () => env)
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
    expect(body.answer).toMatch(/^Next ferries from Bulimba ferry terminal to Riverside ferry terminal: /)
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

  it('never reports an all-clear when the alert feed is unavailable (Codex review round 2)', async () => {
    const s = setup()
    const body = (await (await s.ask('any alerts for ferries')).json()) as { source: string; answer: string }
    expect(body.source).toBe('deterministic')
    expect(body.answer).not.toMatch(/^No current alerts/)
    expect(body.answer).toMatch(/can't confirm|aren't available/)
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

describe('route-restricted answers keep the route in scope (Codex round 5)', () => {
  it('a negative answer for route 199 says so', async () => {
    const { answerIntent } = await import('../src/ai/answer.ts')
    const fetchApi = async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          staticGeneration: 'g',
          serviceDates: [],
          rtSourceTimestamp: null,
          rtState: 'unavailable',
          generatedAt: 1,
          mode: 'bus',
          stop: { key: '10795', name: 'Cultural Centre', stopIds: ['10795'] },
          to: null,
          departures: [],
        }),
      )
    const a = await answerIntent(
      {
        kind: 'departures_at',
        mode: 'bus',
        at: { mode: 'bus', key: '10795', name: 'Cultural Centre', score: 1 },
        route: '199',
      },
      fetchApi,
      0,
    )
    expect(a.answer).toBe('No upcoming route 199 buses from Cultural Centre found.')
  })
})

describe('route alerts with suffixed route ids (Codex round 4)', () => {
  it('"alerts on F1" finds an alert for route F1-4055', async () => {
    const { answerIntent } = await import('../src/ai/answer.ts')
    const fetchApi = async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          staticGeneration: null,
          serviceDates: [],
          rtSourceTimestamp: 1,
          rtState: 'live',
          generatedAt: 1,
          alerts: [
            {
              id: 'a',
              header: 'Services suspended due to weather',
              activePeriods: [],
              routes: ['F1-4055'],
              stops: [],
              modes: ['ferry'],
            },
          ],
        }),
      )
    const a = await answerIntent({ kind: 'alerts', line: 'f1' }, fetchApi, 0)
    expect(a.answer).toMatch(/^1 alert for f1: Services suspended due to weather/)
  })
})

describe('intent cache (Codex round 6)', () => {
  it('is keyed by stop-index generation in memory too', async () => {
    const { __intentCacheForTests: c } = await import('../src/ai/routes.ts')
    c.clear()
    const intent = {
      kind: 'departures_at' as const,
      mode: 'ferry' as const,
      at: { mode: 'ferry' as const, key: 'OLD', name: 'x', score: 1 },
    }
    c.remember('departures at x', intent, 'g1')
    expect(await c.recall('departures at x', 'g1')).toEqual(intent)
    expect(await c.recall('departures at x', 'g2')).toBeNull()
  })
})

describe('helpers', () => {
  it('hashes IP prefixes, not addresses', async () => {
    expect(await ipKey('1.2.3.4', 's')).toBe(await ipKey('1.2.3.99', 's'))
    expect(await ipKey('1.2.4.4', 's')).not.toBe(await ipKey('1.2.3.4', 's'))
    expect(await ipKey(null, 's')).toBeNull()
  })
  it('hashes the first 48 bits of IPv6, expanding :: (Codex PR review)', async () => {
    expect(ipv6Prefix48('2001:db8::1')).toBe('2001:db8:0')
    expect(ipv6Prefix48('2001:db8:0:1::2')).toBe('2001:db8:0')
    expect(await ipKey('2001:db8::1', 's')).toBe(await ipKey('2001:db8:0:1::2', 's'))
  })
})

// ------------------------------------------------------------------ LLM path with a stubbed provider

function memoryBudget() {
  let state = emptyBudgetState('20261020')
  const stub = {
    reserve: async (cfg: BudgetConfig, id: string, usd: number, ip: string | null, count: boolean) => {
      const r = reserve(state, cfg, id, usd, ip, count, Date.now())
      if (r.result.ok) state = r.state
      return r.result
    },
    reconcile: async (id: string, usd: number) => {
      state = reconcile(state, id, usd)
    },
    status: async () => state,
  }
  return { ns: { idFromName: () => 'global', get: () => stub }, state: () => state }
}

const msg = (content: unknown[], stop_reason: string) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content,
      stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: 1200,
        output_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

type Final = (firstRef: string) => unknown[]

function llmSetup(
  finalContent: Final,
  firstCall: unknown = {
    name: 'get_departures',
    input: { mode: 'ferry', stopKey: '317584', toKey: '317590', limit: 3 },
  },
) {
  const budget = memoryBudget()
  const env = {
    AI_ENABLED: 'true',
    ANTHROPIC_API_KEY: 'test-key',
    AI_MONTHLY_BUDGET_USD: '10',
    TURNSTILE_SECRET: 'secret',
    AI_GATEWAY: 'bft',
    CF_ACCOUNT_ID: 'acct',
    BUDGET: budget.ns,
  }
  const urls: string[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    urls.push(url)
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: Array<{ content: unknown }> }
    const last = body.messages.at(-1)?.content
    if (Array.isArray(last) && (last[0] as { type?: string })?.type === 'tool_result') {
      const res = JSON.parse((last[0] as { content: string }).content) as {
        departures?: Array<{ ref: string }>
        emptyRef?: string
      }
      return msg(finalContent(res.departures?.[0]?.ref ?? res.emptyRef ?? 'none'), 'tool_use')
    }
    return msg([{ type: 'tool_use', id: 'tu_1', ...(firstCall as object) }], 'tool_use')
  })
  const s = setup(env, { verifyTurnstile: async () => true })
  return { ...s, budget, urls, spy }
}

const Q = 'is there anything sailing between bulimba and riverside soon'
const finalCall = (input: unknown) => [{ type: 'tool_use', id: 'tu_f', name: 'final_answer', input }]

describe('LLM fallback (stubbed provider)', () => {
  it('renders the answer server-side from cited rows, through AI Gateway, and records spend', async () => {
    const s = llmSetup((ref) => finalCall({ kind: 'departures', refs: [ref] }))
    const body = (await (await s.ask(Q)).json()) as { source: string; answer: string; departures: unknown[] }
    s.spy.mockRestore()
    expect(body.source).toBe('llm')
    expect(body.departures).toHaveLength(1)
    expect(body.answer).toMatch(
      /^From Bulimba ferry terminal to Riverside ferry terminal: F\d+ to .+ at \d{1,2}:\d{2}/,
    )
    expect(s.urls.every((u) => u.startsWith('https://gateway.ai.cloudflare.com/v1/acct/bft/anthropic'))).toBe(
      true,
    )
    expect(s.budget.state().spentUsd).toBeGreaterThan(0)
    expect(s.budget.state().reservedUsd).toBe(0)
  })

  it('rejects a final answer citing rows no tool returned (ungrounded)', async () => {
    const s = llmSetup(() => finalCall({ kind: 'departures', refs: ['d99'] }))
    const body = (await (await s.ask(Q)).json()) as { source: string; ai: { reason: string } }
    s.spy.mockRestore()
    expect(body.source).toBe('fallback')
    expect(body.ai.reason).toBe('ungrounded')
  })

  it('rejects free text: the model may not write the answer (Codex review round 2)', async () => {
    const s = llmSetup(() => [{ type: 'text', text: 'The ferry leaves at half past nine.' }])
    const body = (await (await s.ask(Q)).json()) as { source: string; ai: { reason: string } }
    s.spy.mockRestore()
    expect(body.ai.reason).toBe('no_final_answer')
  })

  it('reservations bound the actual usage reported by the provider', async () => {
    const s = llmSetup((ref) => finalCall({ kind: 'departures', refs: [ref] }))
    const reserved: number[] = []
    const orig = s.budget.ns.get().reserve
    s.budget.ns.get().reserve = async (cfg, id, usd, ip, count) => {
      reserved.push(usd)
      return orig(cfg, id, usd, ip, count)
    }
    await s.ask(Q)
    s.spy.mockRestore()
    // Each stubbed round reports 1,200 input + 80 output tokens ($0.00016); every reservation is above that.
    expect(reserved.length).toBe(2)
    for (const r of reserved) expect(r).toBeGreaterThan(0.00016)
  })

  it('a network failure keeps the full reservation as spend (never refunds an uncertain call)', async () => {
    const budget = memoryBudget()
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    const s = setup(
      {
        AI_ENABLED: 'true',
        ANTHROPIC_API_KEY: 'k',
        AI_MONTHLY_BUDGET_USD: '10',
        TURNSTILE_SECRET: 's',
        AI_GATEWAY: 'bft',
        CF_ACCOUNT_ID: 'a',
        BUDGET: budget.ns,
      },
      { verifyTurnstile: async () => true },
    )
    const body = (await (await s.ask(Q)).json()) as { source: string }
    spy.mockRestore()
    expect(body.source).toBe('fallback')
    expect(budget.state().spentUsd).toBeGreaterThan(0)
    expect(budget.state().reservedUsd).toBe(0)
  })

  it('a "no services" answer must cite the specific empty query, and renders its scope (Codex round 4)', async () => {
    const s = llmSetup((emptyRef) => finalCall({ kind: 'no_service', emptyRef }), {
      name: 'get_departures',
      input: { mode: 'ferry', stopKey: 'QUIET', limit: 3 },
    })
    const body = (await (await s.ask(Q)).json()) as { source: string; answer: string }
    s.spy.mockRestore()
    expect(body.source, JSON.stringify(body)).toBe('llm')
    expect(body.answer, JSON.stringify(body)).toBe('No upcoming services from QUIET.')
  })

  it('a "no alerts" answer citing a departures query (wrong tool) is ungrounded', async () => {
    const s = llmSetup((emptyRef) => finalCall({ kind: 'no_alerts', emptyRef }), {
      name: 'get_departures',
      input: { mode: 'ferry', stopKey: 'QUIET', limit: 3 },
    })
    const body = (await (await s.ask(Q)).json()) as { ai: { reason: string } }
    s.spy.mockRestore()
    expect(body.ai.reason).toBe('ungrounded')
  })

  it('fails closed without an AI Gateway', async () => {
    const budget = memoryBudget()
    const spy = vi.spyOn(globalThis, 'fetch')
    const s = setup(
      {
        AI_ENABLED: 'true',
        ANTHROPIC_API_KEY: 'k',
        AI_MONTHLY_BUDGET_USD: '10',
        TURNSTILE_SECRET: 's',
        BUDGET: budget.ns,
      },
      { verifyTurnstile: async () => true },
    )
    const body = (await (await s.ask(Q)).json()) as { ai: { reason: string } }
    expect(body.ai.reason).toBe('gateway_not_configured')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
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
