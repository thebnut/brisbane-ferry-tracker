/**
 * Plain-English alert summaries (src/ai/alert-summary.ts): content key, grounding checks, scheduling, cost controls
 * and the hub wiring. No provider calls are made: every provider fetch is a stub.
 */
import { readFileSync } from 'node:fs'
import { type Alert, RtSnapshot } from '@bft/core'
import { describe, expect, it } from 'vitest'
import {
  AlertSummariser,
  BACKOFF_BASE_MS,
  checkSummary,
  contentKey,
  EVICT_AFTER_MS,
  MAX_ENTRIES,
  MAX_PER_RUN,
  STORAGE_KEY,
  type SummaryProvider,
  summaryProviderConfig,
} from '../src/ai/alert-summary.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { ALERTS_EVERY_MS, CYCLE_MS, HubCore } from '../src/rt/hub-core.ts'
import {
  alert,
  buildTree,
  Clock,
  D,
  epoch,
  FakeStorage,
  FakeUpstream,
  feed,
  storeFor,
  tripUpdate,
  vehicle,
} from './fixtures.ts'

// Real alerts (staging /v1/alerts, 26 Oct 2026), trimmed.
const ROUTE_200: Alert = {
  id: '1189681',
  header: '8:25am route 200 to Kelso cancelled',
  description: 'The 8:25am route 200 to Kelso is cancelled due to staff availability.',
  effect: 'REDUCED_SERVICE',
  cause: 'OTHER_CAUSE',
  activePeriods: [{ start: 1792000000 }],
  routes: ['200-5146'],
  stops: [],
  modes: ['bus'],
}
const IPSWICH: Alert = {
  id: '1154076',
  header: 'Late night track closure - Ipswich/Rosewood and Springfield lines',
  description:
    'Track closure in briefStart: 9:30pm Wednesday 28 OctoberEnd: Last service Wednesday 28 OctoberAffected lines: Ipswich/Rosewood and Springfield linesNext normal service: First train on Thursday 29 OctoberView map of closure. ',
  effect: 'REDUCED_SERVICE',
  cause: 'MAINTENANCE',
  activePeriods: [],
  routes: ['BRIP-4997', 'BRSP-4998'],
  stops: [],
  modes: ['train'],
}
const TRAM: Alert = {
  id: '1171121',
  header: 'November evening tram closures - Helensvale to Gold Coast University Hospital',
  description:
    'Buses will replace trams between Helensvale and Gold Coast University Hospital stations each night from 7:30pm until last service: Sunday 8 to Thursday 12 NovemberWednesday 25 and Thursday 26 NovemberSunday 29 and Monday 30 November.This is due to Coomera Connector (Stage 1) construction works.',
  effect: 'REDUCED_SERVICE',
  cause: 'MAINTENANCE',
  activePeriods: [],
  routes: ['500-4841', 'L1-5029'],
  stops: ['317584'],
  modes: ['tram'],
}

describe('contentKey', () => {
  it('is stable under reordering of routes and stops, whitespace and active periods', () => {
    const k = contentKey(IPSWICH)
    expect(contentKey({ ...IPSWICH, routes: [...IPSWICH.routes].reverse() })).toBe(k)
    expect(contentKey({ ...TRAM, stops: ['b', 'a'] })).toBe(contentKey({ ...TRAM, stops: ['a', 'b'] }))
    expect(contentKey({ ...IPSWICH, header: `  ${IPSWICH.header.replace(/ /g, '  ')} ` })).toBe(k)
    expect(contentKey({ ...IPSWICH, activePeriods: [{ start: 1, end: 2 }], id: 'other' })).toBe(k)
  })

  it('changes when any summarised field changes', () => {
    const k = contentKey(ROUTE_200)
    const variants: Partial<Alert>[] = [
      { header: '8:35am route 200 to Kelso cancelled' },
      { description: 'The 8:25am route 200 to Kelso is delayed.' },
      { effect: 'DETOUR' },
      { cause: 'WEATHER' },
      { routes: ['201-5146'] },
      { stops: ['1'] },
    ]
    for (const v of variants) expect(contentKey({ ...ROUTE_200, ...v })).not.toBe(k)
  })
})

describe('checkSummary (grounding)', () => {
  it('accepts grounded one-sentence summaries of real alerts', () => {
    const good: Array<[string, Alert]> = [
      ['The 8:25am route 200 to Kelso is cancelled, so plan to catch a later service.', ROUTE_200],
      [
        'No Ipswich/Rosewood or Springfield line trains from 9:30pm Wednesday 28 October until the first train Thursday.',
        IPSWICH,
      ],
      [
        'Buses replace trams between Helensvale and Gold Coast University Hospital from 7:30pm on some November nights.',
        TRAM,
      ],
      ['Trams on route L1 are replaced by buses on some evenings, so allow extra time.', TRAM],
    ]
    for (const [s, a] of good) expect(checkSummary(s, a), s).toEqual({ ok: true, summary: s })
  })

  const reject = (s: string, a: Alert = ROUTE_200) => {
    const r = checkSummary(s, a)
    return r.ok ? 'ok' : r.reason
  }

  it('rejects empty, too long and multi-sentence output', () => {
    expect(reject('   ')).toBe('empty')
    expect(reject(`The route 200 bus is cancelled ${'today '.repeat(30)}.`)).toBe('too_long')
    expect(reject('The 8:25am route 200 is cancelled. Catch a later bus.')).toBe('multiple_sentences')
    expect(reject('The 8:25am route 200 is cancelled\nCatch a later bus')).toBe('multiple_sentences')
  })

  it('rejects URLs, emails and phone numbers', () => {
    expect(reject('Route 200 is cancelled, see https://translink.com.au for more.')).toBe('contact')
    expect(reject('Route 200 is cancelled, see translink.com.au for more.')).toBe('contact')
    expect(reject('Route 200 is cancelled, email help@translink.com.au for more.')).toBe('contact')
    expect(reject('Route 200 is cancelled, call 13 12 30 for help.')).toBe('contact')
    // A six-digit stop id in the alert is not a phone number.
    expect(
      reject('Trams stop at 317584 only on route L1 tonight.', { ...TRAM, header: `${TRAM.header} tonight` }),
    ).toBe('ok')
  })

  it('rejects numbers, times and dates not in the alert', () => {
    expect(reject('The 8:35am route 200 to Kelso is cancelled.')).toBe('number')
    expect(reject('The 8:25am route 200 to Kelso is cancelled for 2 hours.')).toBe('number')
    expect(reject('The 8:25am route 200 to Kelso is cancelled, with two later services also affected.')).toBe(
      'number',
    )
    expect(reject('The 8:25am route 200 to Kelso is cancelled on Monday.')).toBe('date')
    expect(reject('The 8:25am route 200 to Kelso is cancelled today.')).toBe('date')
    expect(reject('Trams are replaced by buses from 7:30pm on 31 November.', TRAM)).toBe('number')
  })

  it('rejects route or stop codes not in the alert', () => {
    expect(reject('The 8:25am route 200 to Kelso is cancelled, so take the P200 instead.')).toBe('code')
    expect(reject('Route 200 is cancelled at the CBD stop.')).toBe('code')
    expect(reject('Trams on route L12 are replaced by buses on some evenings.', TRAM)).toBe('code')
  })

  it('Codex r1: rejects written numbers, the month May, lower-case codes and recombined times and dates', () => {
    expect(reject('Route 200 is cancelled for sixteen hours.')).toBe('number')
    expect(reject('Route 200 to Kelso is cancelled in May.')).toBe('date')
    expect(reject('Route 200 to Kelso may be cancelled.')).toBe('ok') // the verb
    expect(reject('Route p200 to Kelso is cancelled.')).toBe('code')
    const mixed: Alert = {
      ...IPSWICH,
      header: 'Closures 7:30am and 9:30pm',
      description: 'From 28 October to 29 November.',
    }
    expect(reject('Trains stop from 7:30pm on 28 November.', mixed)).toBe('date')
    expect(reject('Trains stop from 9:30pm on 28 October.', mixed)).toBe('ok')
    expect(reject('Trains stop from 9.30 pm on 28 October.', mixed)).toBe('ok')
    // Reordered, so not extractive: rejected (conservative).
    expect(reject('Trains stop from 9:30pm on October 28.', mixed)).toBe('date')
  })

  it('Codex r2: rejects recombined numeric dates and written numbers, lower-case codes and "may" the month', () => {
    const src: Alert = {
      ...ROUTE_200,
      header: 'Route F1 works',
      description: '28/10/2026 to 29/11/2026; twenty minutes at two stops.',
      routes: ['F1-4055'],
    }
    expect(reject('Route F1 is closed on 28/10/2026.', src)).toBe('ok')
    expect(reject('Route F1 is closed on 28/11/2026.', src)).toBe('number')
    expect(reject('Route F1 is closed for twenty minutes.', src)).toBe('ok')
    expect(reject('Route F1 is closed for twenty two minutes.', src)).toBe('number')
    expect(reject('Take brcl instead of F1.', src)).toBe('code')
    expect(reject('Take Brcl instead of F1.', src)).toBe('code')
    // Known elsewhere (another alert's route), even when it has vowels.
    expect(checkSummary('Take Brip instead of F1.', src, new Set(['BRIP']))).toEqual({
      ok: false,
      reason: 'code',
    })
    expect(reject('Route F1 is closed in may.', src)).toBe('date')
    expect(reject('Route F1 is closed until May.', src)).toBe('date')
    expect(reject('Route F1 services may be cancelled.', src)).toBe('ok')
    // A real May date in the alert allows it.
    expect(reject('Route F1 is closed in May.', { ...src, description: 'Closed in May.' })).toBe('ok')
  })

  it('Codex r1: rejects any domain-shaped text or URI scheme', () => {
    expect(reject('Route 200 is cancelled, see transit.xyz/help for more.')).toBe('contact')
    expect(reject('Route 200 is cancelled, see ftp://x for more.')).toBe('contact')
    expect(reject('Route 200 is cancelled, write to mailto:x for more.')).toBe('contact')
  })

  it('rejects refusals and meta-commentary', () => {
    expect(reject("I'm sorry, I can't summarise this.")).toBe('meta')
    expect(reject('Here is a summary: route 200 to Kelso is cancelled.')).toBe('meta')
    expect(reject('This alert says route 200 to Kelso is cancelled.')).toBe('meta')
    expect(reject('**Route 200 to Kelso is cancelled**')).toBe('meta')
  })
})

describe('summaryProviderConfig (kill switch)', () => {
  const secrets = { ANTHROPIC_API_KEY: 'k', BUDGET: {} as never }

  /** The vars wrangler.jsonc gives an environment (comments stripped). */
  function wranglerVars(envName: 'staging' | 'production'): Record<string, string> {
    const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))
    return json.env[envName].vars
  }

  it('production as configured (AI_ENABLED=false, budget 0) has no provider, even with secrets', () => {
    const vars = wranglerVars('production')
    expect(vars.AI_ENABLED).toBe('false')
    expect(summaryProviderConfig({ ...vars, ...secrets })).toBeNull()
  })

  it('staging as configured has one, through AI Gateway', () => {
    const p = summaryProviderConfig({ ...wranglerVars('staging'), ...secrets })
    expect(p?.baseURL).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[^/]+\/bft\/anthropic$/)
    expect(p?.budget.monthlyBudgetUsd).toBe(10)
  })

  it('fails closed without a key, gateway, account, Budget DO or budget', () => {
    const on = {
      AI_ENABLED: 'true',
      AI_MONTHLY_BUDGET_USD: '10',
      AI_GATEWAY: 'bft',
      CF_ACCOUNT_ID: 'a',
      ...secrets,
    }
    expect(summaryProviderConfig(on)).not.toBeNull()
    for (const k of ['ANTHROPIC_API_KEY', 'AI_GATEWAY', 'CF_ACCOUNT_ID', 'BUDGET'] as const) {
      expect(summaryProviderConfig({ ...on, [k]: undefined }), k).toBeNull()
    }
    expect(summaryProviderConfig({ ...on, AI_MONTHLY_BUDGET_USD: '0' })).toBeNull()
    expect(summaryProviderConfig({ ...on, AI_ENABLED: 'false' })).toBeNull()
  })
})

// ---------------------------------------------------------------- summariser harness

const message = (text: string, stop = 'end_turn') =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 300, output_tokens: 30 },
  })

/** A summary that passes the checks for any alert made by `mk`. */
const goodFor = (a: Alert) => `${a.header} affects riders.`

const mk = (n: number): Alert => ({
  id: `a${n}`,
  header: `Stop works at Bulimba number ${n}`,
  activePeriods: [],
  routes: ['F1-4055'],
  stops: [],
  modes: ['ferry'],
})

function harness(
  opts: {
    enabled?: () => boolean
    reserveOk?: () => boolean
    reserveThrows?: boolean
    reconcileThrows?: boolean
    callTimeoutMs?: number
  } = {},
) {
  const clock = new Clock(Date.UTC(2026, 9, 26))
  const storage = new FakeStorage()
  const calls: string[] = []
  const reserves: number[] = []
  const reconciles: number[] = []
  let inFlight = 0
  let maxInFlight = 0
  /** What the stub provider does with each request: by default a summary built from the alert header. */
  let respond: (header: string) => Promise<Response> = async (header) => message(`${header} affects riders.`)
  const fetchStub = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    const header = /Header: (.*)/.exec(body.messages[0]?.content ?? '')?.[1] ?? ''
    calls.push(header)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      return await respond(header)
    } finally {
      inFlight--
    }
  }) as unknown as typeof fetch
  const provider = (): SummaryProvider | null =>
    opts.enabled?.() === false
      ? null
      : {
          apiKey: 'k',
          baseURL: 'https://gateway.ai.cloudflare.com/v1/acct/bft/anthropic',
          budget: { enabled: true, monthlyBudgetUsd: 10, perIpDailyQuota: 10, alertAt: 0.8 },
          reserve: async (_id, usd) => {
            reserves.push(usd)
            if (opts.reserveThrows) throw new Error('ledger down')
            return opts.reserveOk?.() === false ? { ok: false, reason: 'budget_exhausted' } : { ok: true }
          },
          reconcile: async (_id, usd) => {
            reconciles.push(usd)
            if (opts.reconcileThrows) throw new Error('ledger down')
          },
        }
  const s = new AlertSummariser({
    storage,
    now: clock.now,
    provider,
    fetch: fetchStub,
    callTimeoutMs: opts.callTimeoutMs,
  })
  return {
    s,
    clock,
    storage,
    calls,
    reserves,
    reconciles,
    maxInFlight: () => maxInFlight,
    setRespond: (f: typeof respond) => {
      respond = f
    },
    stored: () =>
      (
        storage.data.get(STORAGE_KEY) as
          | { entries: Record<string, { s?: string; retry?: number }> }
          | undefined
      )?.entries ?? {},
  }
}

describe('AlertSummariser scheduling', () => {
  it('summarises at most MAX_PER_RUN alerts per run, one call at a time, then the rest next run', async () => {
    const h = harness()
    const alerts = Array.from({ length: 8 }, (_, i) => mk(i))
    await h.s.kick(alerts)
    expect(h.calls).toHaveLength(MAX_PER_RUN)
    expect(h.maxInFlight()).toBe(1)
    expect(Object.values(h.stored()).filter((e) => e.s)).toHaveLength(MAX_PER_RUN)
    await h.s.kick(alerts)
    expect(h.calls).toHaveLength(8)
    // Every alert has its summary now: further runs make no calls.
    await h.s.kick(alerts)
    expect(h.calls).toHaveLength(8)
    const attached = h.s.attach(alerts)
    expect(attached.map((a) => a.summary)).toEqual(alerts.map(goodFor))
    // Reservations precede calls, and each is reconciled.
    expect(h.reserves).toHaveLength(8)
    expect(h.reconciles).toHaveLength(8)
  })

  it('a kick while a run is in flight joins it instead of starting another', async () => {
    const h = harness()
    let release = () => {}
    h.setRespond(
      (header) =>
        new Promise((r) => {
          release = () => r(message(`${header} affects riders.`))
        }),
    )
    const first = h.s.kick([mk(1)])
    const second = h.s.kick([mk(2)])
    expect(second).toBe(first)
    await new Promise((r) => setTimeout(r, 10))
    release()
    await first
    expect(h.calls).toEqual(['Stop works at Bulimba number 1'])
  })

  it('summarises once per content change: a changed alert gets a new summary, an unchanged one none', async () => {
    const h = harness()
    await h.s.kick([mk(1)])
    await h.s.kick([{ ...mk(1), activePeriods: [{ start: 5 }], id: 'moved' }])
    expect(h.calls).toHaveLength(1)
    await h.s.kick([{ ...mk(1), header: 'Stop works at Bulimba number 9' }])
    expect(h.calls).toHaveLength(2)
  })

  it('a rejected summary is not stored and backs off 1 h, then 2 h after a repeat', async () => {
    const h = harness()
    h.setRespond(async () => message('Visit https://translink.com.au for details.'))
    const a = [mk(1)]
    await h.s.kick(a)
    expect(h.calls).toHaveLength(1)
    expect(h.s.attach(a)[0]?.summary).toBeUndefined()
    h.clock.advance(BACKOFF_BASE_MS - 1)
    await h.s.kick(a)
    expect(h.calls).toHaveLength(1)
    h.clock.advance(1)
    await h.s.kick(a)
    expect(h.calls).toHaveLength(2)
    h.clock.advance(BACKOFF_BASE_MS)
    await h.s.kick(a)
    expect(h.calls).toHaveLength(2) // second failure: 2 h
    h.clock.advance(BACKOFF_BASE_MS)
    h.setRespond(async () => message(goodFor(mk(1))))
    await h.s.kick(a)
    expect(h.calls).toHaveLength(3)
    expect(h.s.attach(a)[0]?.summary).toBe(goodFor(mk(1)))
  })

  it('a provider error backs off, stores nothing and keeps the reservation unless the 4xx was unbilled', async () => {
    const h = harness()
    h.setRespond(async () => new Response('{"type":"error"}', { status: 500 }))
    await h.s.kick([mk(1)])
    expect(h.reconciles[0]).toBe(h.reserves[0])
    expect(Object.values(h.stored())[0]?.retry).toBe(h.clock.t + BACKOFF_BASE_MS)
    h.setRespond(async () => new Response('{"type":"error"}', { status: 400 }))
    await h.s.kick([mk(2)])
    expect(h.reconciles[1]).toBe(0)
    h.setRespond(async () => {
      throw new TypeError('network down')
    })
    await h.s.kick([mk(3)])
    expect(h.s.attach([mk(1), mk(2), mk(3)]).every((a) => a.summary === undefined)).toBe(true)
    expect(h.calls).toHaveLength(3)
  })

  it('a refusal or max_tokens stop is a failure, not a summary', async () => {
    const h = harness()
    h.setRespond(async (header) => message(`${header} affects riders.`, 'refusal'))
    await h.s.kick([mk(1)])
    h.setRespond(async (header) => message(`${header} affects riders.`, 'max_tokens'))
    await h.s.kick([mk(2)])
    expect(h.s.attach([mk(1), mk(2)]).every((a) => a.summary === undefined)).toBe(true)
  })

  it('kill switch off: no calls and no reservations', async () => {
    let on = false
    const h = harness({ enabled: () => on })
    await h.s.kick([mk(1), mk(2)])
    expect(h.calls).toHaveLength(0)
    expect(h.reserves).toHaveLength(0)
    on = true // read per run
    await h.s.kick([mk(1), mk(2)])
    expect(h.calls).toHaveLength(2)
  })

  it('budget denied: no calls, no backoff, retried next run', async () => {
    let ok = false
    const h = harness({ reserveOk: () => ok })
    await h.s.kick([mk(1), mk(2)])
    expect(h.calls).toHaveLength(0)
    expect(h.reserves).toHaveLength(1) // stops at the first denial
    ok = true
    await h.s.kick([mk(1), mk(2)])
    expect(h.calls).toHaveLength(2)
  })

  it('Codex r1: a response body that stalls after the headers times out, keeps the reservation and backs off', async () => {
    const h = harness({ callTimeoutMs: 50 })
    h.setRespond(
      async () =>
        new Response(new ReadableStream({ start: () => {} }), {
          headers: { 'content-type': 'application/json' },
        }),
    )
    const t0 = Date.now()
    await h.s.kick([mk(1)])
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(h.reconciles).toEqual(h.reserves) // billed as the bound
    expect(Object.values(h.stored())[0]?.retry).toBe(h.clock.t + BACKOFF_BASE_MS)
    // Recovers: the next key goes ahead.
    h.setRespond(async (header) => message(`${header} affects riders.`))
    await h.s.kick([mk(1), mk(2)])
    expect(h.s.attach([mk(2)])[0]?.summary).toBe(goodFor(mk(2)))
  })

  it('Codex r1: a failed reconcile still records the outcome (summary or backoff) and persists it', async () => {
    const h = harness({ reconcileThrows: true })
    await h.s.kick([mk(1)])
    expect(h.s.attach([mk(1)])[0]?.summary).toBe(goodFor(mk(1)))
    h.setRespond(async () => new Response('{"type":"error"}', { status: 500 }))
    await h.s.kick([mk(1), mk(2)])
    expect(h.calls).toHaveLength(2)
    expect(h.stored()[contentKey(mk(2))]?.retry).toBe(h.clock.t + BACKOFF_BASE_MS)
    await h.s.kick([mk(1), mk(2)])
    expect(h.calls).toHaveLength(2) // backed off, not retried every cycle
  })

  it('a ledger that throws on reserve is a denial: no call', async () => {
    const h = harness({ reserveThrows: true })
    await h.s.kick([mk(1)])
    expect(h.calls).toHaveLength(0)
    expect(h.stored()[contentKey(mk(1))]?.retry).toBeUndefined()
  })

  it('Codex r1: storage stays within MAX_ENTRIES even when the current feed alone exceeds it', async () => {
    const h = harness({ enabled: () => false })
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => mk(i))
    await h.s.kick(many)
    expect(Object.keys(h.stored())).toHaveLength(MAX_ENTRIES)
    // Old keys make room for new current ones.
    await h.s.kick([mk(MAX_ENTRIES + 5)])
    expect(Object.keys(h.stored())).toHaveLength(MAX_ENTRIES)
    expect(h.stored()[contentKey(mk(MAX_ENTRIES + 5))]).toBeDefined()
  })

  it('evicts keys not seen for 7 days, keeping current ones', async () => {
    const h = harness()
    await h.s.kick([mk(1), mk(2)])
    expect(Object.keys(h.stored())).toHaveLength(2)
    h.clock.advance(EVICT_AFTER_MS / 2)
    await h.s.kick([mk(2)])
    h.clock.advance(EVICT_AFTER_MS / 2 + 1)
    await h.s.kick([mk(2)])
    expect(Object.keys(h.stored())).toEqual([contentKey(mk(2))])
  })

  it('restores stored summaries after a restart, and keeps restored ones before the store loads', async () => {
    const h = harness()
    await h.s.kick([mk(1)])
    const s2 = new AlertSummariser({ storage: h.storage, now: h.clock.now, provider: () => null })
    const carried = { ...mk(1), summary: 'carried' }
    expect(s2.attach([carried])[0]?.summary).toBe('carried')
    await s2.kick([mk(1)])
    expect(s2.attach([carried])[0]?.summary).toBe(goodFor(mk(1)))
    // A summary for content that no longer matches is dropped.
    expect(s2.attach([{ ...mk(3), summary: 'stale' }])[0]?.summary).toBeUndefined()
  })
})

// ---------------------------------------------------------------- hub wiring

class FakeR2 {
  readonly files = new Map<string, string>()
  async put(key: string, value: Uint8Array | string) {
    this.files.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value))
  }
  async get(key: string) {
    const b = this.files.get(key)
    return b ? { text: async () => b } : null
  }
}

function hubSetup(respond: (header: string) => Promise<Response>) {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const up = new FakeUpstream()
  const storage = new FakeStorage()
  const r2 = new FakeR2()
  const calls: string[] = []
  const fetchStub = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    const header = /Header: (.*)/.exec(body.messages[0]?.content ?? '')?.[1] ?? ''
    calls.push(header)
    return respond(header)
  }) as unknown as typeof fetch
  const summaries = new AlertSummariser({
    storage,
    now: clock.now,
    fetch: fetchStub,
    provider: () => ({
      apiKey: 'k',
      baseURL: 'https://gateway.ai.cloudflare.com/v1/acct/bft/anthropic',
      budget: { enabled: true, monthlyBudgetUsd: 10, perIpDailyQuota: 10, alertAt: 0.8 },
      reserve: async () => ({ ok: true }),
      reconcile: async () => {},
    }),
  })
  const hub = new HubCore({
    storage,
    fetch: up.fetch,
    now: clock.now,
    store: storeFor(buildTree(), clock.now),
    config: parseRtModes('ferry'),
    upstream: 'https://up.test/api/realtime/SEQ',
    fetchTimeoutMs: 50,
    r2,
    layout: 'documents',
    summaries,
  })
  const nowS = () => Math.floor(clock.t / 1000)
  up.set(
    'TripUpdates/Ferry',
    feed(nowS(), [
      tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [
        { seq: 1, stopId: '317584', depTime: epoch(D, '08:02:00') },
      ]),
    ]),
  )
  up.set('VehiclePositions/Ferry', feed(nowS(), [vehicle('V1', 'T1', D, -27.45, 153.05)]))
  up.set('alerts', feed(nowS(), [alert('a1', 'Bulimba works', 'F1-4055')]))
  const alertsDoc = () => {
    const ptr = JSON.parse(r2.files.get('rt/latest.json') as string)
    return {
      seq: ptr.files.alerts.seq,
      doc: RtSnapshot.parse(JSON.parse(r2.files.get(ptr.files.alerts.key) as string)),
    }
  }
  return { clock, hub, summaries, calls, alertsDoc }
}

describe('RtHub alert summaries', () => {
  it('a late summary rewrites the alerts document with a new seq, and pull serves it', async () => {
    const h = hubSetup(async () => message('Bulimba works affect F1 ferries.'))
    await h.hub.alarm()
    await h.summaries.idle()
    const before = h.alertsDoc()
    expect(before.doc.alerts[0]?.summary).toBeUndefined()
    expect(h.calls).toEqual(['Bulimba works'])
    h.clock.advance(CYCLE_MS)
    await h.hub.alarm()
    const after = h.alertsDoc()
    expect(after.seq).toBeGreaterThan(before.seq)
    expect(after.doc.alerts[0]?.summary).toBe('Bulimba works affect F1 ferries.')
    const pulled = RtSnapshot.parse(JSON.parse((await h.hub.pull(null, 'alerts')).json as string))
    expect(pulled.alerts[0]?.summary).toBe('Bulimba works affect F1 ferries.')
    // No further rewrite or call once it is in.
    for (let i = 0; i < 6; i++) {
      h.clock.advance(CYCLE_MS)
      await h.hub.alarm()
      await h.summaries.idle()
    }
    expect(h.alertsDoc().seq).toBe(after.seq)
    expect(h.calls).toHaveLength(1)
  })

  it('a cycle never waits on a slow provider, and cycles keep running while it hangs', async () => {
    let release = () => {}
    const h = hubSetup(
      () =>
        new Promise((r) => {
          release = () => r(message('Bulimba works affect F1 ferries.'))
        }),
    )
    const t0 = Date.now()
    await h.hub.alarm()
    expect(h.calls).toHaveLength(0) // the run starts after the publish; its call is still pending
    for (let i = 0; i < 6; i++) {
      h.clock.advance(CYCLE_MS)
      await h.hub.alarm()
    }
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(h.hub.status().lastError).toBeNull()
    expect(h.calls).toHaveLength(1) // one in flight, the later alerts cycles joined it
    release()
    await h.summaries.idle()
    h.clock.advance(CYCLE_MS)
    await h.hub.alarm()
    expect(h.alertsDoc().doc.alerts[0]?.summary).toBe('Bulimba works affect F1 ferries.')
  })

  it('a failing provider never fails a cycle', async () => {
    const h = hubSetup(async () => {
      throw new TypeError('network down')
    })
    for (let i = 0; i < 1 + ALERTS_EVERY_MS / CYCLE_MS; i++) {
      await h.hub.alarm()
      await h.summaries.idle()
      expect(h.hub.status().lastError).toBeNull()
      h.clock.advance(CYCLE_MS)
    }
    expect(h.calls).toHaveLength(1) // backed off after the first failure
    expect(h.alertsDoc().doc.alerts[0]?.summary).toBeUndefined()
  })
})
