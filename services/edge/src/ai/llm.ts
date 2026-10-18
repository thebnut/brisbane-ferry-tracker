/**
 * LLM fallback for /v1/ask (ADR-0008): Claude Haiku 5.5 through Cloudflare AI Gateway with our own tools.
 * At most 2 tool rounds, max_tokens 400, cached system prompt, no conversation history.
 *
 * Cost: before every provider attempt the caller reserves an upper bound in the Budget DO and reconciles
 * afterwards. The bound uses UTF-8 bytes of everything sent (a token always covers at least one byte) plus fixed
 * overhead, priced as cache writes, so actual usage can't exceed the reservation.
 *
 * Grounding: the model never writes answer text. It must call `final_answer` with refs to rows returned by tools
 * in this request (or a predefined reason); the server renders the answer from those rows.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  actualUsd,
  anthropicTools,
  FINAL_ANSWER_TOOL,
  type FinalAnswer,
  FinalAnswerInput,
  isGroundedAnswer,
  type ToolName,
  worstCaseUsd,
} from '@bft/core'
import { EvidenceLog, runTool, type ToolContext } from './tools.ts'

export const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 400
/** 2 tool rounds, then a round that may only call final_answer. */
const MAX_ROUNDS = 3
/** Aggregate cap on tool-result text across the whole request. */
const MAX_TOOL_RESULT_CHARS = 9000
/** Per-request framing the provider adds around system, tools and messages (generous). */
const OVERHEAD_TOKENS = 1500

const SYSTEM = `You help answer questions about Brisbane (South East Queensland) ferry, train and bus departures.
Use search_stops to find stop keys, get_departures for services (pass toKey for "from X to Y"), get_trip for one service, get_alerts for disruptions.
You never write the answer yourself. Always finish by calling final_answer: cite the ref values of the departure rows or alerts that answer the question, for "none" answers cite the emptyRef of the empty result (no_alerts or no_service), or give a cannot_answer reason (trip_planning for multi-step journeys, unknown_stop, out_of_scope).`

/** Upper bound on input tokens: UTF-8 bytes of the request body plus overhead (a token covers >= 1 byte). */
export const inputTokenBound = (body: unknown) =>
  new TextEncoder().encode(JSON.stringify(body)).length + OVERHEAD_TOKENS

export interface LlmDeps {
  apiKey: string
  /** https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/anthropic */
  baseURL: string
  reserve: (id: string, usd: number, countQuestion: boolean) => Promise<{ ok: boolean; reason?: string }>
  reconcile: (id: string, usd: number) => Promise<void>
  tools: ToolContext
  nowS: number
}

export interface LlmResult {
  ok: boolean
  final?: FinalAnswer
  evidence: EvidenceLog
  reason?: string
  costUsd: number
  rounds: number
}

export async function askLlm(question: string, deps: LlmDeps): Promise<LlmResult> {
  const client = new Anthropic({ apiKey: deps.apiKey, baseURL: deps.baseURL, maxRetries: 0, timeout: 15_000 })
  const evidence = new EvidenceLog()
  const ctx: ToolContext = { ...deps.tools, evidence }
  const dataTools = anthropicTools().map((t) => ({
    ...t,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }))
  const finalTool = {
    ...FINAL_ANSWER_TOOL,
    input_schema: FINAL_ANSWER_TOOL.input_schema as Anthropic.Tool.InputSchema,
  }
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
  ]
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question.slice(0, 300) }]
  let cost = 0
  let toolChars = 0
  const fail = (reason: string, rounds: number): LlmResult => ({
    ok: false,
    reason,
    evidence,
    costUsd: cost,
    rounds,
  })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const tools = round < MAX_ROUNDS - 1 ? [...dataTools, finalTool] : [finalTool]
    const bound = worstCaseUsd(Math.ceil(inputTokenBound({ system, tools, messages }) * 1.25), MAX_TOKENS)
    const id = crypto.randomUUID()
    const r = await deps.reserve(id, bound, round === 0)
    if (!r.ok) return fail(r.reason ?? 'budget', round)
    let res: Anthropic.Message
    try {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Thinking off keeps the 400-token cap for tool calls; Haiku 5.5 accepts disabled at effort low.
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system,
        tools,
        tool_choice: { type: 'auto' },
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming)
    } catch (e) {
      // Only a 4xx rejection is known to be unbilled; timeouts, connection loss and 5xx keep the full bound.
      const unbilled =
        e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 400 && e.status < 500
      await deps.reconcile(id, unbilled ? 0 : bound)
      if (!unbilled) cost += bound
      const reason =
        e instanceof Anthropic.RateLimitError
          ? 'provider_rate_limited'
          : e instanceof Anthropic.APIError
            ? `provider_${e.status}`
            : 'provider_error'
      return fail(reason, round + 1)
    }
    const u = res.usage
    const spent = actualUsd(
      (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) * 1.25 +
        (u.cache_read_input_tokens ?? 0) * 0.1,
      u.output_tokens ?? 0,
    )
    cost += spent
    await deps.reconcile(id, spent)

    if (res.stop_reason === 'refusal') return fail('refusal', round + 1)
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const final = calls.find((b) => b.name === 'final_answer')
    if (final) {
      const parsed = FinalAnswerInput.safeParse(final.input)
      if (!parsed.success) return fail('bad_final_answer', round + 1)
      const ev = {
        departures: new Set(evidence.departures.keys()),
        alerts: new Set(evidence.alerts.keys()),
        empty: new Map([...evidence.empty].map(([k, v]) => [k, v.tool])),
      }
      if (!isGroundedAnswer(parsed.data, ev)) return fail('ungrounded', round + 1)
      return { ok: true, final: parsed.data, evidence, costUsd: cost, rounds: round + 1 }
    }
    if (calls.length === 0) return fail('no_final_answer', round + 1)
    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const block of calls) {
      const out = await runTool(ctx, block.name as ToolName, block.input, deps.nowS)
      const left = Math.max(0, MAX_TOOL_RESULT_CHARS - toolChars)
      const content = left > 40 ? JSON.stringify(out.result).slice(0, left) : '{"error":"budget"}'
      toolChars += content.length
      results.push({ type: 'tool_result', tool_use_id: block.id, content, is_error: !out.ok })
    }
    messages.push({ role: 'user', content: results })
  }
  return fail('too_many_rounds', MAX_ROUNDS)
}
