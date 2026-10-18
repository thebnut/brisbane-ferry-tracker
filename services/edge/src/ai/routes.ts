/**
 * /v1/ask (natural language, ADR-0008) and /mcp (read-only MCP server over the same tools).
 *
 * Order of resolution for /v1/ask: intent cache → deterministic parser → (AI_ENABLED, budget, quota, Turnstile)
 * LLM fallback → deterministic hint. The kill switch AI_ENABLED is read per request.
 */
import {
  type BudgetConfig,
  DEFAULT_BUDGET,
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
import { type InternalFetch, runTool, slimDeparture } from './tools.ts'

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

const AskBody = z.object({ question: z.string().min(1).max(300), turnstileToken: z.string().optional() })

/** Intents learned per isolate (deterministic parses and LLM tool plans). Answers are never cached. */
const intentCache = new Map<string, Intent>()
const remember = (k: string, i: Intent) => {
  if (intentCache.size > 2000) intentCache.clear()
  intentCache.set(k, i)
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

    const cachedIntent = intentCache.get(normalized)
    const parse = cachedIntent ? null : parseQuestion(question, resolverFor(indexes))
    const intent = cachedIntent ?? (parse?.ok ? parse.intent : null)
    if (intent) {
      if (!cachedIntent) remember(normalized, intent)
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
          ok: false,
          reason: 'disabled',
        }
        return res.ok ? { ok: true } : { ok: false, reason: res.reason }
      },
      reconcile: async (id, usd) => {
        await budget?.reconcile(id, usd)
      },
      tools: { fetch: fetchApi, indexes },
      nowS,
    })
    if (!r.ok) return c.json({ ...hint, ai: { enabled: true, reason: r.reason } })
    // LLM tool plans are not cached as intents: they can carry semantics an Intent can't express (Codex PR review).
    const departures = (r.rows ?? []).map((d) => slimDeparture(d, nowS))
    const facts = departures.map(
      (d) => `${d.route} to ${d.headsign} at ${d.departs}${d.status === 'live' ? ' (live)' : ''}`,
    )
    return c.json({
      ...base,
      source: 'llm',
      answer: facts.length ? `${r.answer}\n${facts.join('; ')}.` : r.answer,
      departures,
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
