/**
 * Phase 8: /v1/ask (deterministic path, kill switch, budget gating, grounding) and the read-only /mcp server.
 * No provider calls are made: the LLM path is exercised with AI disabled or a stubbed fetch.
 */
import { type BudgetConfig, DEFAULT_BUDGET, emptyBudgetState, reconcile, reserve } from '@bft/core'
import { describe, expect, it, vi } from 'vitest'
import type { SynthTrip } from '../../../packages/core/test/helpers.ts'
import {
  type AiDeps,
  budgetConfig,
  cityReply,
  ipKey,
  ipv6Prefix48,
  quotedTerm,
  registerAi,
  siteverify,
} from '../src/ai/routes.ts'
import {
  admitInWindow,
  admitStored,
  VERIFY_BUDGET,
  VERIFY_BUDGET_NAME,
  type VerifyWindow,
  type WindowStore,
} from '../src/ai/verify-window.ts'
import { createApp } from '../src/app.ts'
import { silentLogger } from '../src/log.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import { buildTree, Clock, D, epoch, storeFor } from './fixtures.ts'

const NAMES: Record<string, string> = {
  '317584': 'Bulimba ferry terminal',
  '317590': 'Riverside ferry terminal',
  '317586': 'Hawthorne ferry terminal',
}

let extraGen = 0

function setup(
  env: Record<string, unknown> = {},
  extra: {
    verifyTurnstile?: () => Promise<boolean>
    siteverify?: AiDeps['siteverify']
    /** More ferry stop-index entries as [key, name] (no trips). */
    stops?: Array<[string, string]>
    /** Ferry trips instead of the default fixtures (their stops still need stop-index entries). */
    trips?: Record<string, SynthTrip[]>
    /** Replaces the data generation lookup (e.g. to make the data source fail). */
    generationKey?: AiDeps['generationKey']
  } = {},
) {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  vi.setSystemTime(clock.t)
  // Extra stops or trips get their own generation: the stop-index and station caches are keyed by it.
  const gen = extra.stops || extra.trips ? `g1-${++extraGen}` : 'g1'
  const tree = buildTree(gen, extra.trips)
  // Real-looking names so the fuzzy resolver has something to match.
  const stops = [
    ...['317584', '317590', '317586', 'QUIET'].map((key) => [key, NAMES[key] ?? key]),
    ...(extra.stops ?? []),
  ].map(([key, name]) => ({ key, name, lat: -27.4, lon: 153, routes: [] }))
  tree.source.files.set(
    'data/ferry/stops.json',
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, mode: 'ferry', generation: gen, stops })),
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
  const { stops: _stops, trips: _trips, ...deps } = extra
  registerAi(app, { store, generationKey: async () => gen, ...deps }, () => env)
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

describe('stop names the parser cannot place (AI off unless stated)', () => {
  type Body = {
    source: string
    answer: string
    intent?: { from: { key: string } }
    ai?: { enabled: boolean }
  }
  const ask = async (s: ReturnType<typeof setup>, q: string) => (await (await s.ask(q)).json()) as Body

  it('a missing space still resolves: "next ferry from southbank to bulimba"', async () => {
    const s = setup({}, { stops: [['321666', 'South Bank ferry terminal']] })
    const body = await ask(s, 'next ferry from southbank to bulimba')
    expect(body.source).toBe('deterministic')
    expect(body.intent?.from.key).toBe('321666')
  })

  it('an ambiguous stop gets its specific message with AI off (it used to get the generic hint)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const s = setup(
      {},
      {
        stops: [
          ['QS1', 'Queen Street 1'],
          ['QS2', 'Queen Street 2'],
        ],
      },
    )
    const body = await ask(s, 'departures at queen street ferry')
    expect(body.source).toBe('fallback')
    // The mode is named, so the reply names the places instead of asking for the mode (R11-A1).
    expect(body.answer).toBe(
      "'queen street' matches more than one ferry terminal. Did you mean 'Queen Street 1' or 'Queen Street 2'? Use the full name.",
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('without a mode, the ambiguity reply still asks for one', async () => {
    const s = setup(
      {},
      {
        stops: [
          ['QS1', 'Queen Street 1'],
          ['QS2', 'Queen Street 2'],
        ],
      },
    )
    const body = await ask(s, 'departures at queen street')
    expect(body.source).toBe('fallback')
    expect(body.answer).toBe(
      "'queen street' matches more than one stop. Did you mean 'Queen Street 1' or 'Queen Street 2'? Add the mode (ferry, train or bus), the full name or the stop number.",
    )
  })

  it('names the stop it could not find', async () => {
    const s = setup()
    const body = await ask(s, 'next ferry from zzyzx to bulimba')
    expect(body.source).toBe('fallback')
    expect(body.ai?.enabled).toBe(false)
    expect(body.answer).toBe(
      "I couldn't find a stop called 'zzyzx'. Try its full name or the stop number on the sign.",
    )
  })

  it('echoes the term as plain text only, trimmed and capped', async () => {
    const s = setup()
    const xss = await ask(s, 'departures at <img src=x onerror="prompt(x)"> ferry terminal')
    expect(xss.answer).toBe(
      "I couldn't find a stop called 'img src=x onerror= prompt(x)'. Try its full name or the stop number on the sign.",
    )
    const long = await ask(s, `next ferry from ${'qwxz '.repeat(30)}to bulimba`)
    expect(long.answer).toBe(
      `I couldn't find a stop called '${'qwxz '.repeat(8).trimEnd()}…'. Try its full name or the stop number on the sign.`,
    )
  })

  it('an unparseable question keeps the generic hint', async () => {
    const body = await ask(setup(), 'can I take my bike on the ferry')
    expect(body.answer).toMatch(/^Try: /)
  })

  it('with AI on, an unresolved stop still goes to the LLM path; its fallback names the stop', async () => {
    const s = setup(
      { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'x', AI_MONTHLY_BUDGET_USD: '10', BUDGET: {} },
      { stops: [] },
    )
    const body = (await (await s.ask('next ferry from zzyzx to bulimba')).json()) as Body & {
      ai: { reason: string }
    }
    expect(body.ai.reason).toBe('turnstile_not_configured')
    expect(body.answer).toMatch(/^I couldn't find a stop called 'zzyzx'\./)
  })
})

describe('THE-117: "going to", the trailing-word retry and the gates', () => {
  type Body = {
    source: string
    answer: string
    intent?: { kind: string; from?: { key: string }; to?: { key: string } }
    ai?: { enabled: boolean; reason?: string }
  }
  const ask = async (s: { ask: (q: string) => Promise<Response> | Response }, q: string) =>
    (await (await s.ask(q)).json()) as Body

  it('"Next ferry from bulimba going to riverside?" answers deterministically (it said "bulimba going")', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const body = await ask(setup(), 'Next ferry from bulimba going to riverside?')
    expect(body.source).toBe('deterministic')
    expect([body.intent?.from?.key, body.intent?.to?.key]).toEqual(['317584', '317590'])
    expect(body.answer).toMatch(/^Next ferries from Bulimba ferry terminal to Riverside ferry terminal: /)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('an unresolved explicit stop is retried without its trailing word, before any reply', async () => {
    const body = await ask(setup(), 'next ferry from bulimba jetty to riverside')
    expect(body.source).toBe('deterministic')
    expect([body.intent?.from?.key, body.intent?.to?.key]).toEqual(['317584', '317590'])
  })

  it('with AI on, the retry still answers deterministically: no provider call', async () => {
    const s = llmSetup((ref) => finalCall({ kind: 'departures', refs: [ref] }))
    const body = await ask(s, 'next ferry from bulimba jetty to riverside')
    s.spy.mockRestore()
    // The intent may come from the cache by now; either way it never reached the provider.
    expect(['deterministic', 'cache']).toContain(body.source)
    expect(s.urls).toEqual([])
  })

  it('still unresolved with AI on and within budget: falls through to the LLM path', async () => {
    const s = llmSetup((ref) => finalCall({ kind: 'departures', refs: [ref] }))
    const body = await ask(s, 'next ferry from zzyzx going to riverside')
    s.spy.mockRestore()
    expect(body.source).toBe('llm')
    expect(s.urls.length).toBeGreaterThan(0)
  })

  it('still unresolved with AI off, over budget or failing Turnstile: the canned hint names the stop', async () => {
    const hint = "I couldn't find a stop called 'zzyzx'. Try its full name or the stop number on the sign."
    const off = await ask(setup(), 'next ferry from zzyzx going to riverside')
    expect([off.source, off.ai?.enabled, off.answer]).toEqual(['fallback', false, hint])
    const broke = await ask(
      setup({ AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'x', AI_MONTHLY_BUDGET_USD: '0', BUDGET: {} }),
      'next ferry from zzyzx going to riverside',
    )
    expect([broke.ai?.enabled, broke.answer]).toEqual([false, hint])
    const bot = await ask(
      setup(
        {
          AI_ENABLED: 'true',
          ANTHROPIC_API_KEY: 'x',
          AI_MONTHLY_BUDGET_USD: '10',
          BUDGET: {},
          TURNSTILE_SECRET: 's',
        },
        { verifyTurnstile: async () => false },
      ),
      'next ferry from zzyzx going to riverside',
    )
    expect([bot.ai?.reason, bot.answer]).toEqual(['turnstile_failed', hint])
  })
})

describe('THE-117: towards the city', () => {
  type Body = { source: string; answer: string; departures?: Array<{ route: string; status: string }> }
  const ask = async (s: { ask: (q: string) => Promise<Response> | Response }, q: string) =>
    (await (await s.ask(q)).json()) as Body
  /** Apollo Road (XA): one trip on to Riverside (a city stop), one to Bretts Wharf (XB), which isn't. */
  const trips: Record<string, SynthTrip[]> = {
    [D]: [
      {
        id: 'IN',
        route: 'F1-4055',
        headsign: 'Riverside',
        stops: [
          ['XA', '08:00:00'],
          ['317590', '08:20:00'],
        ],
      },
      {
        id: 'OUT',
        route: 'F1-4055',
        dir: 1,
        headsign: 'Northshore Hamilton',
        stops: [
          ['XA', '08:10:00'],
          ['XB', '08:25:00'],
        ],
      },
    ],
  }
  const cityTree = () =>
    setup(
      {},
      {
        trips,
        stops: [
          ['XA', 'Apollo Road ferry terminal'],
          ['XB', 'Bretts Wharf ferry terminal'],
        ],
      },
    )

  it('"ferry from bulimba to the city": services that call at a city stop later, named as the city', async () => {
    const body = await ask(setup(), 'ferry from bulimba to the city')
    expect(body.source).toBe('deterministic')
    expect(body.answer).toMatch(
      /^Next ferries from Bulimba ferry terminal to the city: F1 to Riverside in 5 min/,
    )
    // The fixture snapshot is unavailable: timetabled, never a false LIVE.
    expect(body.answer).toMatch(/Live times are unavailable, so these are timetabled\.$/)
    expect(body.departures?.every((d) => d.status !== 'live')).toBe(true)
  })

  it('by stopping pattern, not headsign: only the trip that reaches Riverside', async () => {
    const s = cityTree()
    const inb = await ask(s, 'next ferry from apollo road towards the city')
    expect(inb.answer).toMatch(
      /^Next ferries from Apollo Road ferry terminal to the city: F1 to Riverside in 5 min/,
    )
    expect(inb.departures).toHaveLength(1)
    const out = await ask(s, 'next ferry from apollo road out of the city')
    expect(out.answer).toMatch(
      /^Next ferries from Apollo Road ferry terminal away from the city: F1 to Northshore Hamilton in 15 min/,
    )
    expect(out.departures).toHaveLength(1)
  })

  it('a stop whose services reach no city stop gets a clear empty answer', async () => {
    const body = await ask(cityTree(), 'next ferry from bretts wharf to the city')
    expect(body.answer).toBe('No upcoming ferries from Bretts Wharf ferry terminal go on to a city stop.')
  })

  it('from the city to a stop: each line says which city stop it leaves from', async () => {
    const s = setup(
      {},
      {
        stops: [
          ['317593', 'North Quay ferry terminal'],
          ['319637', 'QUT Gardens Point ferry terminal'],
          ['321666', 'South Bank ferry terminal'],
        ],
      },
    )
    const body = await ask(s, 'next ferry from the city to bulimba')
    expect(body.source).toBe('deterministic')
    expect(body.answer).toMatch(
      /^Next ferries from the city to Bulimba ferry terminal: F1 to Northshore Hamilton in 35 min \(8:30.am\), from Riverside ferry terminal\./,
    )
  })

  it('an origin inside the city is said plainly, with AI off and no provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const body = await ask(setup(), 'next ferry from riverside to the city')
    expect(body.source).toBe('fallback')
    expect(body.answer).toBe(
      `'Riverside ferry terminal' is in the city, so "towards the city" doesn't narrow it down. Ask for departures at that stop, or name the stop you're going to.`,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('cityReply: from the city by bus asks for the stop', () => {
    expect(cityReply({ city: { why: 'too_many_stops', dir: 'out' } })).toMatch(
      /^The city has too many bus stops to answer for at once\./,
    )
  })

  it('/v1 departures: `city` is in|out, filters by later stops, and is exclusive with `to`', async () => {
    const s = cityTree()
    const get = async (q: string) => {
      const r = await s.app.request(`/v1/ferry/stops/XA/departures?${q}`)
      return { status: r.status, body: (await r.json()) as { departures?: Array<{ tripInstance: string }> } }
    }
    const trip = (r: { body: { departures?: Array<{ tripInstance: string }> } }) =>
      r.body.departures?.map((d) => d.tripInstance.split('@')[0])
    expect(trip(await get(''))).toEqual(['IN', 'OUT'])
    expect(trip(await get('city=in'))).toEqual(['IN'])
    expect(trip(await get('city=out'))).toEqual(['OUT'])
    expect((await get('city=inbound')).status).toBe(400)
    expect((await get('city=')).status).toBe(400)
    expect((await get('city=in&to=XB')).status).toBe(400)
  })
})

describe('quotedTerm', () => {
  it('strips markup characters and control characters, collapses whitespace, caps length', () => {
    expect(quotedTerm("  st peter's  ")).toBe("'st peters'")
    expect(quotedTerm('a<b>"c"`d\\e\u0000f\u202eg')).toBe("'a b c d e f g'")
    expect(quotedTerm('x'.repeat(50))).toBe(`'${'x'.repeat(40)}…'`)
    expect(quotedTerm('<>')).toBeNull()
    expect(quotedTerm(undefined)).toBeNull()
  })
  it('removes every single-quote style and spaces out every double-quote style', () => {
    expect(quotedTerm('‘foo')).toBe("'foo'")
    expect(quotedTerm('‘st peter’s’')).toBe("'st peters'")
    for (const q of ["'", '`', '´', 'ʹ', 'ʻ', 'ʼ', 'ʽ', '‘', '’', '‚', '‛', '′', '‵', '‹', '›', '＇', '｀'])
      expect(quotedTerm(`${q}a${q}b${q}`)).toBe("'ab'")
    for (const q of ['"', '«', '»', '“', '”', '„', '‟', '″', '‶', '〝', '〞', '〟', '＂'])
      expect(quotedTerm(`${q}a${q}b${q}`)).toBe("'a b'")
    expect(quotedTerm('‘’“”')).toBeNull()
    expect(quotedTerm('〟')).toBeNull()
    expect(quotedTerm(`‘${'x'.repeat(50)}’`)).toBe(`'${'x'.repeat(40)}…'`)
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
      if (r.result.ok) {
        ok++
        // Each call settles at its full reservation (the worst case); at most 500 can be in flight at once.
        s = reconcile(s, `r${i}`, 0.0035, 0)
      }
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

describe('next-day answers say so (R2-X6b)', () => {
  // 10:42 pm Sunday 18 Oct 2026 in Brisbane (UTC+10).
  const now = Date.UTC(2026, 9, 18, 12, 42) / 1000
  const row = (dep: number) => ({
    tripInstance: `t${dep}`,
    stopSequence: 1,
    route: { id: 'AIRT', short: 'AIRT', long: 'Airport' },
    headsign: 'Domestic',
    directionId: 0,
    stopId: '600029',
    platform: '2',
    schedDep: dep,
    estDep: null,
    schedArrTo: null,
    estArrTo: null,
    status: 'scheduled',
    gps: false,
    vehicleId: null,
  })
  it('a departure tomorrow carries "tomorrow" and the date; today and 2 days on read plainly', async () => {
    const { answerIntent, timeWithDay } = await import('../src/ai/answer.ts')
    // (Intl may put a narrow no-break space before am/pm.)
    const t = (s: number) => timeWithDay(s, now).replace(/\s/g, ' ')
    expect(t(now + 600)).toBe('10:52 pm')
    expect(t(now + 21_060)).toBe('4:33 am tomorrow (19/10)')
    expect(t(now + 2 * 86_400)).toBe('10:42 pm (20/10)')
    const fetchApi = async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          staticGeneration: 'g',
          serviceDates: ['20261018', '20261019'],
          rtSourceTimestamp: null,
          rtState: 'live',
          generatedAt: now * 1000,
          mode: 'train',
          stop: { key: 'fortitude-valley', name: 'Fortitude Valley', stopIds: [] },
          to: { key: 'domestic', name: 'Domestic' },
          departures: [row(now + 21_060)],
        }),
      )
    const a = await answerIntent(
      {
        kind: 'next_departure',
        from: { mode: 'train', key: 'fortitude-valley', name: 'Fortitude Valley', score: 1 },
        to: { mode: 'train', key: 'domestic', name: 'Domestic', score: 1 },
      },
      fetchApi,
      now,
    )
    expect(a.answer.replace(/\s/g, ' ')).toContain('at 4:33 am tomorrow (19/10)')
  })
})

describe('R24-A1: the timetabled caveat says why', () => {
  const now = Date.UTC(2026, 9, 18, 12, 42) / 1000
  const row = (dep: number, status = 'scheduled') => ({
    tripInstance: `t${dep}`,
    stopSequence: 1,
    route: { id: 'F1', short: 'F1', long: 'CityCat' },
    headsign: 'Riverside',
    directionId: 0,
    stopId: '317584',
    platform: null,
    schedDep: dep,
    estDep: status === 'live' ? dep + 60 : null,
    schedArrTo: null,
    estArrTo: null,
    status,
    gps: false,
    vehicleId: null,
  })
  const answer = async (rtState: string, statuses: string[]) => {
    const { answerIntent } = await import('../src/ai/answer.ts')
    const fetchApi = async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          staticGeneration: 'g',
          serviceDates: ['20261018'],
          rtSourceTimestamp: null,
          rtState,
          generatedAt: now * 1000,
          mode: 'ferry',
          stop: { key: '317584', name: 'Bulimba', stopIds: ['317584'] },
          to: null,
          departures: statuses.map((s, i) => row(now + 300 * (i + 1), s)),
        }),
      )
    const a = await answerIntent(
      {
        kind: 'departures_at',
        mode: 'ferry',
        at: { mode: 'ferry', key: '317584', name: 'Bulimba', score: 1 },
      },
      fetchApi,
      now,
    )
    return a.answer
  }

  it('a live feed with no realtime for these trips yet: "no live times for these yet", not "unavailable"', async () => {
    const a = await answer('live', ['scheduled', 'scheduled', 'scheduled'])
    expect(a).toMatch(/ No live times for these yet, so they're timetabled\.$/)
    expect(a).not.toMatch(/unavailable/)
  })

  it('a feed that is behind or reloading: the same, never "unavailable"', async () => {
    for (const state of ['stale', 'reloading']) {
      const a = await answer(state, ['scheduled', 'scheduled'])
      expect(a).toMatch(/ No live times for these yet, so they're timetabled\.$/)
      expect(a).not.toMatch(/unavailable/)
    }
  })

  it('an outage still says live times are unavailable', async () => {
    expect(await answer('unavailable', ['scheduled'])).toMatch(
      / Live times are unavailable, so these are timetabled\.$/,
    )
  })

  it('live rows label themselves: no caveat on a live feed, a partial one on a feed that is behind', async () => {
    const live = await answer('live', ['live', 'scheduled'])
    expect(live).toContain('(live)')
    expect(live).not.toMatch(/timetabled/)
    const behind = await answer('stale', ['unknown', 'scheduled'])
    expect(behind).toMatch(/ Times not marked live are timetabled\.$/)
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
    // A line that matches no alert text, while other alerts exist, is not an all-clear.
    const b = await answerIntent({ kind: 'alerts', mode: 'ferry', line: 'shorncliffe' }, fetchApi, 0)
    expect(b.answer).toBe(
      'No current alert mentions shorncliffe. There is 1 other alert for ferries: ask "ferry alerts" to see them.',
    )
  })
})

describe('LLM alert answers keep freshness (Codex round 7)', () => {
  it('a stale alert is rendered with a caveat', async () => {
    const { renderFinal } = await import('../src/ai/routes.ts')
    const { EvidenceLog } = await import('../src/ai/tools.ts')
    const ev = new EvidenceLog()
    ev.alerts.set('a1', {
      alert: {
        id: 'x',
        header: 'Ferry services suspended',
        activePeriods: [],
        routes: [],
        stops: [],
        modes: ['ferry'],
      },
      rtState: 'stale',
    })
    expect(renderFinal({ kind: 'alerts', refs: ['a1'] }, ev, 0).answer).toBe(
      'Ferry services suspended (the alert feed is out of date, so this may have changed)',
    )
    ev.alerts.set('a2', {
      alert: { id: 'y', header: 'Works', activePeriods: [], routes: [], stops: [], modes: [] },
      rtState: 'live',
    })
    expect(renderFinal({ kind: 'alerts', refs: ['a2'] }, ev, 0).answer).toBe('Works')
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
  it('Streamable HTTP: GET and DELETE are 405 (no SSE stream, no sessions)', async () => {
    const s = setup()
    for (const method of ['GET', 'DELETE']) {
      const res = await s.app.request('/mcp', { method })
      expect(res.status, method).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })

  it('notifications and client responses are accepted with 202 and no body', async () => {
    const s = setup()
    for (const body of [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
      { jsonrpc: '2.0', id: 7, result: {} },
      { jsonrpc: '2.0', id: 8, error: { code: -1, message: 'no' } },
    ]) {
      const res = await s.rpc(body)
      expect(res.status, JSON.stringify(body)).toBe(202)
      expect(await res.text()).toBe('')
    }
  })

  it('speaks 2025-06-18: initialize says so, and an unsupported MCP-Protocol-Version header is a 400', async () => {
    const s = setup()
    const init = (await (
      await s.rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    ).json()) as { result: { protocolVersion: string } }
    expect(init.result.protocolVersion).toBe('2025-06-18')
    const call = (version: string) =>
      s.app.request('/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': version },
      })
    expect((await call('2025-06-18')).status).toBe(200)
    const bad = await call('2099-01-01')
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32600)
  })

  it('only tools/call counts against the MCP limiter, never the Ask one: the handshake is free', async () => {
    const counted: string[] = []
    const s = setup({
      ASK_LIMITER: {
        limit: async () => {
          counted.push('ask')
          return { success: false }
        },
      },
      MCP_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          counted.push(`mcp:${key}`)
          return { success: counted.length <= 1 }
        },
      },
    })
    expect((await s.rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status).toBe(200)
    expect((await s.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    expect((await s.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(200)
    expect((await s.rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).status).toBe(200)
    expect(counted).toEqual([])
    const call = (id: number) =>
      s.rpc({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'search_stops', arguments: { query: 'bulimba' } },
      })
    expect((await call(4)).status).toBe(200)
    const limited = await call(5)
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as { id: number; error: { code: number } }).id).toBe(5)
    expect(counted).toEqual(['mcp:anon', 'mcp:anon'])
  })

  it('a tool that cannot run (data unavailable) is a tool error result, not an HTTP 500', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = setup(
      {},
      {
        generationKey: async () => {
          throw new Error('data source manifest.json: HTTP 503')
        },
      },
    )
    const res = await s.rpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'search_stops', arguments: { query: 'bulimba' } },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: number
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.id).toBe(9)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]?.text).toMatch(/unavailable/)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[mcp] search_stops failed'))
    warn.mockRestore()
  })

  it('JSON-RPC envelopes (Codex r1): parse error -32700; bad jsonrpc, ids and responses -32600; ids 0 and "" kept', async () => {
    const s = setup()
    const raw = (body: string) =>
      s.app.request('/mcp', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
    const parse = await raw('{"jsonrpc":"2.0","id":1,')
    expect(parse.status).toBe(400)
    expect(((await parse.json()) as { error: { code: number } }).error.code).toBe(-32700)
    for (const body of [
      { id: 1, method: 'ping' },
      { jsonrpc: '1.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: null, method: 'ping' },
      { jsonrpc: '2.0', id: { a: 1 }, method: 'ping' },
      { jsonrpc: '2.0', id: 1.5, method: 'ping' },
      { jsonrpc: '2.0', result: {} },
      { jsonrpc: '2.0', id: 4, result: {}, error: { code: 1, message: 'x' } },
      { jsonrpc: '2.0', id: 5, method: 'ping', result: {} },
    ]) {
      const res = await s.rpc(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(((await res.json()) as { error: { code: number } }).error.code, JSON.stringify(body)).toBe(
        -32600,
      )
    }
    for (const id of [0, '']) {
      const res = await s.rpc({ jsonrpc: '2.0', id, method: 'ping' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { id: unknown }).id).toBe(id)
    }
  })

  it('Origin (Codex r1): none, the API’s allowed origins and local dev tools pass; any other is a 403', async () => {
    const s = setup()
    const from = (origin: string, app = s.app) =>
      app.request('/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        headers: { 'content-type': 'application/json', origin },
      })
    for (const ok of ['https://www.brisbaneferry.com', 'http://localhost:6274', 'http://127.0.0.1:3000'])
      expect((await from(ok)).status, ok).toBe(200)
    for (const bad of ['https://evil.example', 'http://localhost.evil.example', 'null']) {
      const res = await from(bad)
      expect(res.status, bad).toBe(403)
      expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32600)
    }
    // The break-glass that opens the API's CORS opens this too.
    const open = setup({ CORS_ALLOW_ALL: 'true' })
    expect((await from('https://evil.example', open.app)).status).toBe(200)
  })

  it('the MCP limiter is keyed by the caller’s IP', async () => {
    const keys: string[] = []
    const s = setup({
      MCP_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key)
          return { success: true }
        },
      },
    })
    for (const ip of ['203.0.113.7', '198.51.100.2'])
      await s.app.request('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search_stops', arguments: { query: 'bulimba' } },
        }),
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      })
    expect(keys).toEqual(['203.0.113.7', '198.51.100.2'])
  })

  it('a body over 64 KB is a 413 before it is parsed', async () => {
    const s = setup()
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } })
    const res = await s.app.request('/mcp', {
      method: 'POST',
      body: big,
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(413)
  })

  it('a browser preflight may send MCP-Protocol-Version (Codex r1)', async () => {
    const s = setup()
    const res = await s.app.request('/mcp', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://www.brisbaneferry.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, mcp-protocol-version',
      },
    })
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('mcp-protocol-version')
  })

  it('batches (dropped in 2025-06-18) and malformed messages are invalid requests', async () => {
    const s = setup()
    for (const body of [
      [{ jsonrpc: '2.0', id: 1, method: 'ping' }],
      { jsonrpc: '2.0', id: 3 },
      { jsonrpc: '2.0' },
      'ping',
    ]) {
      const res = await s.rpc(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32600)
    }
  })
})

describe('/v1/health reports the AI status (was hardcoded off)', () => {
  it('uses the aiStatus dependency when present', async () => {
    const clock = new Clock(epoch(D, '07:55:00') * 1000)
    const tree = buildTree()
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
      aiStatus: async () => ({ enabled: true, budgetUsedUsd: 0.0015 }),
    })
    const body = (await (await app.request('/v1/health')).json()) as { ai: unknown }
    expect(body.ai).toEqual({ enabled: true, budgetUsedUsd: 0.0015 })
  })
})

describe('aiHealthStatus (Codex review)', () => {
  it('keeps enabled truthful when the ledger fails, and reports spend when it works', async () => {
    const { aiHealthStatus } = await import('../src/ai/routes.ts')
    const base = { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', AI_MONTHLY_BUDGET_USD: '10' }
    const ns = (status: () => Promise<{ spentUsd: number }>) =>
      ({ idFromName: () => 'g', get: () => ({ status }) }) as never
    expect(await aiHealthStatus({ ...base, BUDGET: ns(async () => ({ spentUsd: 0.5 })) })).toEqual({
      enabled: true,
      budgetUsedUsd: 0.5,
    })
    expect(
      await aiHealthStatus({
        ...base,
        BUDGET: ns(async () => {
          throw new Error('do down')
        }),
      }),
    ).toEqual({ enabled: true, budgetUsedUsd: null })
    expect(await aiHealthStatus({})).toEqual({ enabled: false, budgetUsedUsd: null })
  })
})

describe('POST /v1/turnstile/verify (for the feedback relays)', () => {
  const verifyReq = (
    app: { request: (p: string, i: RequestInit) => Response | Promise<Response> },
    body: unknown,
  ) =>
    app.request('/v1/turnstile/verify', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })

  it('verifies with the Worker secret and returns only success, hostname and action', async () => {
    const calls: unknown[][] = []
    const s = setup(
      { TURNSTILE_SECRET: 'sek' },
      {
        siteverify: async (...args) => {
          calls.push(args)
          return { success: true, hostname: 'www.brisbaneferry.com', action: 'feedback' }
        },
      },
    )
    const r = await verifyReq(s.app, { token: 'tok', remoteip: '203.0.113.1' })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const text = await r.text()
    expect(JSON.parse(text)).toEqual({ success: true, hostname: 'www.brisbaneferry.com', action: 'feedback' })
    expect(text).not.toContain('sek')
    expect(calls).toEqual([['sek', 'tok', '203.0.113.1']])
  })

  it('no secret → 503, bad body → 400, siteverify unreachable → 502 (callers fail closed)', async () => {
    const never = vi.fn()
    expect((await verifyReq(setup({}, { siteverify: never }).app, { token: 't' })).status).toBe(503)
    const s = setup({ TURNSTILE_SECRET: 'sek' }, { siteverify: never })
    for (const bad of [
      {},
      { token: '' },
      { token: 'x'.repeat(2049) },
      { token: 't', remoteip: 'x'.repeat(65) },
    ])
      expect((await verifyReq(s.app, bad)).status).toBe(400)
    expect(never).not.toHaveBeenCalled()
    const down = setup(
      { TURNSTILE_SECRET: 'sek' },
      {
        siteverify: async () => {
          throw new TypeError('fetch failed')
        },
      },
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await verifyReq(down.app, { token: 't' })
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'siteverify_unavailable' })
  })

  /** A Budget DO namespace whose 'turnstile-verify' instance is one real counter (what a singleton DO gives us). */
  function verifyBudget(limit = VERIFY_BUDGET.limit) {
    let w: Parameters<typeof admitInWindow>[0] = null
    const names: string[] = []
    const stub = {
      admitVerify: vi.fn(async (_l: number, windowMs: number) => {
        const r = admitInWindow(w, Date.now(), limit, windowMs)
        w = r.window
        return r.ok
      }),
    }
    const ns = {
      idFromName: (n: string) => {
        names.push(n)
        return n
      },
      get: () => stub,
    }
    return { ns, stub, names }
  }

  it('is limited per CF-Connecting-IP (never the body remoteip) before the budget and siteverify', async () => {
    const sv = vi.fn(async () => ({ success: true, hostname: 'h', action: 'feedback' }))
    const perIp = { limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== '198.51.100.66' })) }
    const b = verifyBudget()
    const s = setup({ TURNSTILE_SECRET: 'sek', VERIFY_LIMITER: perIp, BUDGET: b.ns }, { siteverify: sv })
    const req = (ip: string, remoteip?: string) =>
      s.app.request('/v1/turnstile/verify', {
        method: 'POST',
        body: JSON.stringify({ token: 'junk', remoteip }),
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      })
    // A spoofed body remoteip doesn't change the key.
    const limited = await req('198.51.100.66', '203.0.113.1')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(sv).not.toHaveBeenCalled()
    expect(b.stub.admitVerify).not.toHaveBeenCalled()
    expect((await req('203.0.113.2')).status).toBe(200)
    expect(perIp.limit.mock.calls.map(([o]) => o.key)).toEqual(['198.51.100.66', '203.0.113.2'])
    expect(b.names).toEqual([VERIFY_BUDGET_NAME])
    expect(b.stub.admitVerify).toHaveBeenCalledWith(VERIFY_BUDGET.limit, VERIFY_BUDGET.windowMs)
  })

  it('the aggregate budget is one counter across locations: two edge isolates share it', async () => {
    const sv = vi.fn(async () => ({ success: true, hostname: 'h', action: 'feedback' }))
    const b = verifyBudget(3)
    // Two isolates in different Cloudflare locations: separate apps (and per-location limiters), one DO.
    const sydney = setup({ TURNSTILE_SECRET: 'sek', BUDGET: b.ns }, { siteverify: sv })
    const tokyo = setup({ TURNSTILE_SECRET: 'sek', BUDGET: b.ns }, { siteverify: sv })
    const statuses: number[] = []
    for (const app of [sydney.app, tokyo.app, sydney.app, tokyo.app, sydney.app])
      statuses.push((await verifyReq(app, { token: 't' })).status)
    expect(statuses).toEqual([200, 200, 200, 429, 429])
    expect(sv).toHaveBeenCalledTimes(3)
  })

  it('the persisted window survives an eviction mid-minute (Codex review round 3)', async () => {
    const data = new Map<string, unknown>()
    const writes: unknown[] = []
    const store: WindowStore = {
      get: async <T>(k: string) => data.get(k) as T | undefined,
      put: async <T>(k: string, v: T) => {
        writes.push(v)
        data.set(k, v)
      },
    }
    let cached: VerifyWindow | null = null
    const admit = async (t: number) => {
      const r = await admitStored(store, cached, t, 3, 60_000)
      cached = r.window
      return r.ok
    }
    expect([await admit(0), await admit(1000), await admit(2000), await admit(3000)]).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(writes).toHaveLength(3) // rejections write nothing
    // Evicted after ~10 s idle: memory is gone, storage isn't. Still the same window, still full.
    cached = null
    expect(await admit(11_000)).toBe(false)
    cached = null
    expect(await admit(60_001)).toBe(true) // the window has passed
  })

  it('a storage failure throws (the route then answers 503)', async () => {
    const store: WindowStore = {
      get: async () => undefined,
      put: async () => {
        throw new Error('storage down')
      },
    }
    await expect(admitStored(store, null, 0, 3, 60_000)).rejects.toThrow('storage down')
  })

  it('admitInWindow: a fixed window of `limit`, then a fresh one', () => {
    let w: Parameters<typeof admitInWindow>[0] = null
    const at = (t: number) => {
      const r = admitInWindow(w, t, 2, 1000)
      w = r.window
      return r.ok
    }
    expect([at(0), at(10), at(20), at(999), at(1000), at(1001)]).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ])
    expect(at(1002)).toBe(false)
  })

  it('a limiter or budget DO that errors fails closed (503, no siteverify)', async () => {
    const sv = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { limit: async () => Promise.reject(new Error('down')) }
    const s = setup({ TURNSTILE_SECRET: 'sek', VERIFY_LIMITER: broken }, { siteverify: sv })
    expect((await verifyReq(s.app, { token: 't' })).status).toBe(503)
    const deadDo = {
      idFromName: () => 'x',
      get: () => ({ admitVerify: async () => Promise.reject(new Error('DO down')) }),
    }
    const s2 = setup({ TURNSTILE_SECRET: 'sek', BUDGET: deadDo }, { siteverify: sv })
    expect((await verifyReq(s2.app, { token: 't' })).status).toBe(503)
    expect(sv).not.toHaveBeenCalled()
  })

  it('siteverify(): posts secret, token and IP as a form; throws on a non-2xx answer', async () => {
    const f = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      expect([form.get('secret'), form.get('response'), form.get('remoteip')]).toEqual([
        'sek',
        'tok',
        '192.0.2.1',
      ])
      return Response.json({ success: true, hostname: 'h', action: 'feedback', 'error-codes': [] })
    })
    expect(await siteverify('sek', 'tok', '192.0.2.1', f as typeof fetch)).toEqual({
      success: true,
      hostname: 'h',
      action: 'feedback',
    })
    expect(String(f.mock.calls[0]?.[0])).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    await expect(
      siteverify('sek', 'tok', null, (async () => new Response('', { status: 500 })) as typeof fetch),
    ).rejects.toThrow()
    expect(
      await siteverify('sek', 'tok', null, (async () => Response.json({ success: 'yes' })) as typeof fetch),
    ).toEqual({ success: false, hostname: null, action: null })
  })
})
