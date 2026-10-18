/**
 * /v1/ask (natural language, ADR-0008) and /mcp (read-only MCP server over the same tools).
 *
 * Order of resolution for /v1/ask: intent cache → deterministic parser → (AI_ENABLED, budget, quota, Turnstile)
 * LLM fallback → deterministic hint. The kill switch AI_ENABLED is read per request.
 */
import {
  type BudgetConfig,
  DEFAULT_BUDGET,
  type FinalAnswer,
  type Intent,
  normalizeQuestion,
  parseQuestion,
  SCHEMA_VERSION,
  TOOLS,
} from '@bft/core'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { StaticStore } from '../data/static-store.ts'
import { answerIntent } from './answer.ts'
import { askLlm } from './llm.ts'
import { loadIndexes, resolverFor } from './resolver.ts'
import { type EvidenceLog, type InternalFetch, runTool, slimDeparture } from './tools.ts'

export interface AiEnv {
  AI_ENABLED?: string
  AI_MONTHLY_BUDGET_USD?: string
  AI_PER_IP_DAILY?: string
  /** AI Gateway name in this account (created in the dashboard/API). */
  AI_GATEWAY?: string
  CF_ACCOUNT_ID?: string
  ANTHROPIC_API_KEY?: string
  TURNSTILE_SECRET?: string
  IP_HASH_SALT?: string
  BUDGET?: DurableObjectNamespace<import('./budget-do.ts').Budget>
  ASK_LIMITER?: { limit: (o: { key: string }) => Promise<{ success: boolean }> }
}

export function budgetConfig(env: AiEnv): BudgetConfig {
  return {
    ...DEFAULT_BUDGET,
    enabled: env.AI_ENABLED === 'true' && !!env.ANTHROPIC_API_KEY && !!env.BUDGET,
    monthlyBudgetUsd: Number(env.AI_MONTHLY_BUDGET_USD ?? '0') || 0,
    perIpDailyQuota: Number(env.AI_PER_IP_DAILY ?? '10') || 10,
  }
}

/**
 * AI status for /v1/health: the kill switch as configured, plus month-to-date spend from the Budget DO. A ledger
 * failure keeps `enabled` truthful and reports spend as unknown (null) (Codex review).
 */
export async function aiHealthStatus(
  env: AiEnv,
): Promise<{ enabled: boolean; budgetUsedUsd: number | null }> {
  const enabled = budgetConfig(env).enabled
  if (!enabled || !env.BUDGET) return { enabled, budgetUsedUsd: null }
  try {
    const ledger = await env.BUDGET.get(env.BUDGET.idFromName('global')).status()
    return { enabled, budgetUsedUsd: ledger.spentUsd }
  } catch {
    return { enabled, budgetUsedUsd: null }
  }
}

const AskBody = z.object({ question: z.string().min(1).max(300), turnstileToken: z.string().optional() })

/** Intents learned per isolate (deterministic parses and LLM tool plans). Answers are never cached. */
/** generation|question -> intent with expiry (both tiers keyed by stop-index generation; Codex review round 6). */
const intentCache = new Map<string, { intent: Intent; until: number }>()
/** Intent cache (ADR-0008): isolate memory, backed by the Cache API for 30 days (a no-op on *.workers.dev). */
const INTENT_TTL_S = 30 * 24 * 3600
const cacheUrl = (k: string, gen: string) =>
  `https://intent-cache.bft.internal/${encodeURIComponent(gen)}/${encodeURIComponent(k)}`
async function recall(k: string, gen: string): Promise<Intent | null> {
  const hit = intentCache.get(`${gen}|${k}`)
  if (hit && hit.until > Date.now()) return hit.intent
  try {
    const res = await caches.default.match(cacheUrl(k, gen))
    if (!res) return null
    const intent = (await res.json()) as Intent
    intentCache.set(`${gen}|${k}`, { intent, until: Date.now() + INTENT_TTL_S * 1000 })
    return intent
  } catch {
    return null
  }
}
const remember = (k: string, i: Intent, gen: string, waitUntil?: (p: Promise<unknown>) => void) => {
  if (intentCache.size > 2000) intentCache.clear()
  intentCache.set(`${gen}|${k}`, { intent: i, until: Date.now() + INTENT_TTL_S * 1000 })
  try {
    const put = caches.default.put(
      cacheUrl(k, gen),
      new Response(JSON.stringify(i), {
        headers: { 'cache-control': `max-age=${INTENT_TTL_S}`, 'content-type': 'application/json' },
      }),
    )
    waitUntil?.(put.catch(() => {}))
  } catch {
    // Cache API unavailable (tests, workers.dev): isolate memory only.
  }
}

/** The first 48 bits of an IPv6 address as 3 hextets, expanding "::" (Codex PR review). */
export function ipv6Prefix48(ip: string): string {
  const [head = '', tail] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups =
    tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  return groups
    .slice(0, 3)
    .map((g) => Number.parseInt(g || '0', 16).toString(16))
    .join(':')
}

/** Hashed IP prefix (/24 for IPv4, /48 for IPv6): per-IP quotas without storing addresses. */
export async function ipKey(ip: string | null | undefined, salt: string): Promise<string | null> {
  if (!ip) return null
  const prefix = ip.includes(':') ? ipv6Prefix48(ip) : ip.split('.').slice(0, 3).join('.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${prefix}`))
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  ip: string | null,
): Promise<boolean> {
  if (!token) return false
  const form = new FormData()
  form.set('secret', secret)
  form.set('response', token)
  if (ip) form.set('remoteip', ip)
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  return r.ok && ((await r.json()) as { success?: boolean }).success === true
}

const CANNOT_ANSWER: Record<string, string> = {
  trip_planning:
    'I can\'t plan multi-step journeys yet. Try asking for the next service between two stops, e.g. "next train from Bowen Hills to the airport".',
  unknown_stop: "I couldn't find that stop. Try its full name or the stop number on the sign.",
  out_of_scope: 'I can only answer questions about Brisbane ferry, train and bus departures and alerts.',
}

/** Render every word of an LLM answer from tool rows (the model only chose which rows). */
export function renderFinal(final: FinalAnswer, ev: EvidenceLog, nowS: number) {
  if (final.kind === 'cannot_answer')
    return { answer: CANNOT_ANSWER[final.reason] ?? CANNOT_ANSWER.out_of_scope }
  if (final.kind === 'no_alerts' || final.kind === 'no_service') {
    const scope = ev.empty.get(final.emptyRef)?.scope ?? 'that'
    return {
      answer:
        final.kind === 'no_alerts' ? `No current alerts for ${scope}.` : `No upcoming services ${scope}.`,
    }
  }
  if (final.kind === 'alerts') {
    const alerts = final.refs.map((ref) => ev.alerts.get(ref)).filter((a) => a != null)
    const stale = alerts.some((a) => a.rtState !== 'live')
    return {
      answer: alerts.length
        ? `${alerts.map(({ alert: a }) => a.summary ?? a.header).join(' | ')}${stale ? ' (the alert feed is out of date, so this may have changed)' : ''}`
        : 'No current alerts are reported for that.',
    }
  }
  const rows = final.refs.map((ref) => ev.departures.get(ref)).filter((d) => d != null)
  const groups = new Map<string, typeof rows>()
  for (const d of rows) {
    const k = `${d.stop}|${d.to ?? ''}`
    groups.set(k, [...(groups.get(k) ?? []), d])
  }
  const parts = [...groups.values()].map((g) => {
    const first = g[0] as (typeof rows)[number]
    const head = first.to ? `From ${first.stop} to ${first.to}` : `From ${first.stop}`
    const lines = g.map(({ row }) => {
      const s = slimDeparture(row, nowS)
      const flag = row.status === 'cancelled' ? ' (cancelled)' : row.status === 'live' ? ' (live)' : ''
      return `${s.route} to ${s.headsign} at ${s.departs}${s.platform ? `, platform ${s.platform}` : ''}${flag}`
    })
    const caveat = first.rtState === 'live' ? '' : ' (timetabled; live times unavailable)'
    return `${head}: ${lines.join('; ')}${caveat}.`
  })
  return { answer: parts.join(' '), departures: rows.map(({ row }) => slimDeparture(row, nowS)) }
}

export interface AiDeps {
  store: StaticStore
  /** Turnstile verification; injectable for tests. Every real provider call requires it. */
  verifyTurnstile?: (secret: string, token: string | undefined, ip: string | null) => Promise<boolean>
  /** Manifest updatedAt or generation string, used to key the stop-index cache. */
  generationKey: () => Promise<string>
}

// biome-ignore lint/suspicious/noExplicitAny: the host app's Env generic varies.
export function registerAi(app: Hono<any>, deps: AiDeps, getEnv: (c: { env: unknown }) => AiEnv): void {
  const internal =
    (c: { req: { url: string } }): InternalFetch =>
    async (path) =>
      app.request(new URL(path, c.req.url).toString())

  app.post('/v1/ask', async (c) => {
    const env = getEnv(c)
    const parsed = AskBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return c.json({ error: 'bad_request', detail: 'question (1-300 chars) required' }, 400)
    const ipRaw = c.req.header('cf-connecting-ip') ?? null
    if (env.ASK_LIMITER) {
      const { success } = await env.ASK_LIMITER.limit({ key: ipRaw ?? 'anon' })
      if (!success) return c.json({ error: 'rate_limited' }, 429)
    }
    const nowS = Math.floor(Date.now() / 1000)
    const question = parsed.data.question
    const normalized = normalizeQuestion(question)
    const fetchApi = internal(c)
    const indexes = await loadIndexes(deps.store, await deps.generationKey())
    const base = { schemaVersion: SCHEMA_VERSION, question, normalized }

    // Intents are keyed by stop-index generation too: stop keys can change between timetable versions.
    const gen = await deps.generationKey()
    const cachedIntent = await recall(normalized, gen)
    const parse = cachedIntent ? null : parseQuestion(question, resolverFor(indexes))
    const intent = cachedIntent ?? (parse?.ok ? parse.intent : null)
    if (intent) {
      if (!cachedIntent)
        remember(normalized, intent, gen, (p) => {
          try {
            c.executionCtx.waitUntil(p)
          } catch {
            // No ExecutionContext (tests).
          }
        })
      const a = await answerIntent(intent, fetchApi, nowS)
      return c.json({
        ...base,
        source: cachedIntent ? 'cache' : 'deterministic',
        intent,
        ...a,
        rows: undefined,
      })
    }

    const hint = {
      ...base,
      source: 'fallback' as const,
      answer:
        'Try: "next train from Bowen Hills to the airport", "departures at Bulimba ferry" or "alerts on the Ferny Grove line".',
    }
    const cfg = budgetConfig(env)
    if (!cfg.enabled || cfg.monthlyBudgetUsd <= 0) return c.json({ ...hint, ai: { enabled: false } })
    if (parse && !parse.ok && parse.reason === 'ambiguous_stop')
      return c.json({
        ...hint,
        answer:
          'That name matches more than one stop. Add the mode (ferry, train or bus) or the stop number.',
      })

    const ipHash = await ipKey(ipRaw, env.IP_HASH_SALT ?? 'bft')
    if (!env.TURNSTILE_SECRET)
      return c.json({ ...hint, ai: { enabled: true, reason: 'turnstile_not_configured' } })
    const verify = deps.verifyTurnstile ?? verifyTurnstile
    if (!(await verify(env.TURNSTILE_SECRET, parsed.data.turnstileToken, ipRaw)))
      return c.json({ ...hint, ai: { enabled: true, reason: 'turnstile_failed' } }, 403)
    // Fail closed: provider calls only ever go through AI Gateway (logs, rate limits).
    if (!env.AI_GATEWAY || !env.CF_ACCOUNT_ID)
      return c.json({ ...hint, ai: { enabled: true, reason: 'gateway_not_configured' } })
    const budget = env.BUDGET?.get(env.BUDGET.idFromName('global'))
    const gateway = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY}/anthropic`
    const r = await askLlm(question, {
      apiKey: env.ANTHROPIC_API_KEY as string,
      baseURL: gateway,
      reserve: async (id, usd, countQuestion) => {
        const res = (await budget?.reserve(cfg, id, usd, ipHash, countQuestion)) ?? {
          ok: false as const,
          reason: 'disabled' as const,
        }
        if (res.ok && res.alert)
          // Monitoring hook (ADR-0009): Workers Observability alert rule matches this event.
          console.warn(
            JSON.stringify({
              event: 'ai_budget_alert',
              threshold: cfg.alertAt,
              monthlyBudgetUsd: cfg.monthlyBudgetUsd,
            }),
          )
        return res.ok ? { ok: true } : { ok: false, reason: res.reason }
      },
      reconcile: async (id, usd) => {
        await budget?.reconcile(id, usd)
      },
      tools: { fetch: fetchApi, indexes },
      nowS,
    })
    if (!r.ok || !r.final) return c.json({ ...hint, ai: { enabled: true, reason: r.reason } })
    // LLM tool plans are not cached as intents: they can carry semantics an Intent can't express.
    return c.json({
      ...base,
      source: 'llm',
      ...renderFinal(r.final, r.evidence, nowS),
      rounds: r.rounds,
      costUsd: Number(r.costUsd.toFixed(6)),
    })
  })

  app.get('/v1/ask/status', async (c) => {
    const env = getEnv(c)
    const cfg = budgetConfig(env)
    const status =
      cfg.enabled && env.BUDGET ? await env.BUDGET.get(env.BUDGET.idFromName('global')).status() : null
    return c.json(
      {
        enabled: cfg.enabled,
        monthlyBudgetUsd: cfg.monthlyBudgetUsd,
        perIpDailyQuota: cfg.perIpDailyQuota,
        ledger: status,
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

  // Read-only MCP server (JSON-RPC 2.0 over HTTP, stateless). Caller-paid reasoning: no tokens spent by us.
  app.post('/mcp', async (c) => {
    const env = getEnv(c)
    if (env.ASK_LIMITER) {
      const { success } = await env.ASK_LIMITER.limit({
        key: `mcp:${c.req.header('cf-connecting-ip') ?? 'anon'}`,
      })
      if (!success)
        return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rate limited' } }, 429)
    }
    const msg = (await c.req.json().catch(() => null)) as {
      id?: unknown
      method?: string
      params?: Record<string, unknown>
    } | null
    if (!msg || typeof msg.method !== 'string')
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } }, 400)
    const id = msg.id ?? null
    const ok = (result: unknown) => c.json({ jsonrpc: '2.0', id, result })
    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'brisbane-transit', version: '1.0.0' },
          instructions:
            'Read-only Brisbane ferry, train and bus departures, trips and alerts (TransLink data, CC BY 4.0).',
        })
      case 'notifications/initialized':
        return c.body(null, 202)
      case 'ping':
        return ok({})
      case 'tools/list': {
        const { anthropicTools } = await import('@bft/core')
        return ok({
          tools: anthropicTools().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.input_schema,
            annotations: { readOnlyHint: true },
          })),
        })
      }
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        if (!(name in TOOLS))
          return c.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } })
        const indexes = await loadIndexes(deps.store, await deps.generationKey())
        const out = await runTool(
          { fetch: internal(c), indexes },
          name,
          msg.params?.arguments ?? {},
          Math.floor(Date.now() / 1000),
        )
        return ok({ content: [{ type: 'text', text: JSON.stringify(out.result) }], isError: !out.ok })
      }
      default:
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        })
    }
  })
}

/** Test hook: the in-memory tier, so tests can check generation keying. */
export const __intentCacheForTests = { recall, remember, clear: () => intentCache.clear() }
