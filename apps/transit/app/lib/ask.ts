/**
 * POST /v1/ask (Phase 8, ADR-0008) from the Ask box. The deterministic parser answers without a Turnstile token; the
 * LLM fallback needs one, so the box always sends a fresh invisible-Turnstile token when it can get one.
 *
 * Response shape: bft-api services/edge/src/ai/routes.ts (feat/p8-ai-layer). It isn't in @bft/core's contract yet,
 * so the schema lives here (contract.server.ts checks it at the proxy) until that PR adds one.
 */

/** One answer row (bft-api's slimDeparture). */
export interface AskDeparture {
  tripInstance: string
  route: string
  headsign: string
  platform: string | null
  /** Clock text in Brisbane time, e.g. "7:42 pm". */
  departs: string
  inMinutes: number
  arrives: string | null
  status: 'scheduled' | 'live' | 'skipped' | 'cancelled' | 'unknown'
}

export interface AskResponse {
  schemaVersion: 1
  question: string
  normalized: string
  source: 'cache' | 'deterministic' | 'llm' | 'fallback'
  answer: string
  departures?: AskDeparture[]
  stop?: { mode: 'ferry' | 'train' | 'bus' | 'tram'; key: string; name: string }
  to?: { key: string; name: string } | null
  /** Present when the LLM path was considered but not used (or failed). */
  ai?: { enabled: boolean; reason?: string }
  rounds?: number
  costUsd?: number
}

/** What the box shows: the answer, optional rows, and a friendly note when the AI path was unavailable. */
export interface AskResult {
  answer: string
  departures: AskDeparture[]
  source: AskResponse['source'] | 'error'
  /** Friendly text for ai.reason or an HTTP error, shown under the answer. */
  notice: string | null
  costUsd: number | null
}

/**
 * Friendly text for every `ai.reason` bft-api can return (budget.ts reserve results, routes.ts, llm.ts) plus the
 * HTTP-level 429. Unknown reasons fall back to a generic line, so a new server reason never shows a raw code.
 */
export function reasonMessage(reason: string | undefined, status = 200): string | null {
  if (status === 429 || reason === 'rate_limited')
    return 'Too many questions in a short time. Wait a minute and try again.'
  if (!reason) return null
  switch (reason) {
    case 'ip_quota':
      return "You've reached today's limit for questions that need the AI helper. Simple questions (\"next ferry from Bulimba\") still work."
    case 'budget_exhausted':
    case 'budget':
      return "The AI helper has used this month's budget. Simple questions still work; it's back on the 1st."
    case 'capacity':
      return 'The AI helper is busy right now. Try again in a minute, or ask a simpler question.'
    case 'provider_rate_limited':
      return 'The AI service is rate limited right now. Try again in a minute.'
    case 'disabled':
      return 'The AI helper is switched off right now. Simple questions still work.'
    case 'turnstile_failed':
    case 'turnstile_not_configured':
      return "We couldn't confirm you're not a bot, so the AI helper didn't run. Reload the page and try again."
    case 'gateway_not_configured':
      return 'The AI helper is not set up on this server yet. Simple questions still work.'
    case 'refusal':
    case 'bad_final_answer':
    case 'ungrounded':
    case 'no_final_answer':
    case 'too_many_rounds':
      return "The AI helper couldn't answer that one. Try naming the stop and the mode, e.g. \"next train from Central\"."
    default:
      return reason.startsWith('provider_')
        ? 'The AI service had a problem. Try again in a minute.'
        : "The AI helper couldn't answer that right now."
  }
}

/** Turn a response (any status) into what the box shows. */
export function toResult(status: number, body: unknown): AskResult {
  const b = (body && typeof body === 'object' ? body : {}) as Partial<AskResponse> & { error?: string }
  const notice = reasonMessage(b.ai?.reason ?? b.error, status)
  if (typeof b.answer === 'string')
    return {
      answer: b.answer,
      departures: Array.isArray(b.departures) ? b.departures : [],
      source: b.source ?? 'fallback',
      notice: b.ai?.enabled === false && !b.ai.reason ? null : notice,
      costUsd: typeof b.costUsd === 'number' ? b.costUsd : null,
    }
  return {
    answer: notice ?? "Sorry, that didn't work. Try again in a moment.",
    departures: [],
    source: 'error',
    notice: null,
    costUsd: null,
  }
}

export async function postAsk(
  question: string,
  token: string | null,
  opts: { fixtures?: boolean; signal?: AbortSignal } = {},
): Promise<AskResult> {
  let res: Response
  try {
    res = await fetch(opts.fixtures ? '/__fixtures/v1/ask' : '/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(token ? { question, turnstileToken: token } : { question }),
      signal: opts.signal,
    })
  } catch (error) {
    if (opts.signal?.aborted) throw error
    return {
      answer: "You seem to be offline. Questions need a connection.",
      departures: [],
      source: 'error',
      notice: null,
      costUsd: null,
    }
  }
  const body = await res.json().catch(() => null)
  return toResult(res.status, body)
}
