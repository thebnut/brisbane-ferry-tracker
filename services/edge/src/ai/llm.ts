/**
 * LLM fallback for /v1/ask (ADR-0008): Claude Haiku 5.5 through Cloudflare AI Gateway with our own tools.
 * At most 2 tool rounds, max_tokens 400, cached system prompt, no conversation history. Every provider attempt
 * reserves its worst-case cost in the Budget DO first and reconciles with actual usage afterwards.
 * Answers must be grounded: departures the model cites must come from a get_departures result in this request.
 */
import Anthropic from '@anthropic-ai/sdk'
import { actualUsd, anthropicTools, isGrounded, type ToolName, worstCaseUsd } from '@bft/core'
import { runTool, type ToolContext, type ToolOutcome } from './tools.ts'

export const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 400
const MAX_ROUNDS = 3 // 2 tool rounds + the final answer
/** Input is capped by construction: short system prompt + one question + trimmed tool results. */
const MAX_INPUT_TOKENS = 6000

const SYSTEM = `You answer questions about Brisbane (South East Queensland) public transport departures for ferries, trains and buses.
Use the tools: search_stops to find stop keys, get_departures for times (pass toKey for "from X to Y"), get_trip for one service, get_alerts for disruptions.
Answer only from tool results. Never invent times, platforms or services. If the tools don't answer the question, say so briefly.
You can't plan multi-step journeys; say so and suggest asking for the next service between two stops.
Keep answers under 60 words, plain text. Use 12-hour times as given by the tools.
When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing.
At the end, on its own line, list the tripInstance values of the departures you mentioned as: CITED: id1, id2 (or CITED: none).`

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
  answer: string
  reason?: string
  outcomes: ToolOutcome[]
  costUsd: number
  rounds: number
}

export async function askLlm(question: string, deps: LlmDeps): Promise<LlmResult> {
  const client = new Anthropic({ apiKey: deps.apiKey, baseURL: deps.baseURL, maxRetries: 0, timeout: 15_000 })
  const tools = anthropicTools().map((t) => ({
    ...t,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }))
  // Cache the stable prefix (tools + system).
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
  ]
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question.slice(0, 300) }]
  const outcomes: ToolOutcome[] = []
  let cost = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const id = crypto.randomUUID()
    const r = await deps.reserve(id, worstCaseUsd(MAX_INPUT_TOKENS, MAX_TOKENS), round === 0)
    if (!r.ok)
      return { ok: false, answer: '', reason: r.reason ?? 'budget', outcomes, costUsd: cost, rounds: round }
    let res: Anthropic.Message
    try {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Thinking off keeps the 400-token cap for the answer; Haiku 5.5 accepts disabled at effort low.
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system,
        tools: round < MAX_ROUNDS - 1 ? tools : [],
        tool_choice: { type: 'auto' },
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming)
    } catch (e) {
      await deps.reconcile(id, 0)
      const reason =
        e instanceof Anthropic.RateLimitError
          ? 'provider_rate_limited'
          : e instanceof Anthropic.APIError
            ? `provider_${e.status}`
            : 'provider_error'
      return { ok: false, answer: '', reason, outcomes, costUsd: cost, rounds: round + 1 }
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

    if (res.stop_reason === 'refusal')
      return { ok: false, answer: '', reason: 'refusal', outcomes, costUsd: cost, rounds: round + 1 }
    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        const out = await runTool(deps.tools, block.name as ToolName, block.input, deps.nowS)
        outcomes.push(out)
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(out.result).slice(0, 6000),
          is_error: !out.ok,
        })
      }
      messages.push({ role: 'user', content: results })
      continue
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    const citedLine = /CITED:\s*(.*)$/im.exec(text)?.[1] ?? 'none'
    const cited =
      citedLine.trim().toLowerCase() === 'none'
        ? []
        : citedLine
            .split(/[,\s]+/)
            .filter(Boolean)
            .map((t) => ({ tripInstance: t }))
    const answer = text.replace(/\n?CITED:.*$/im, '').trim()
    // Free text with no tool grounding, or citing departures we never returned, is rejected.
    if (!isGrounded(cited, outcomes))
      return { ok: false, answer: '', reason: 'ungrounded', outcomes, costUsd: cost, rounds: round + 1 }
    return { ok: true, answer, outcomes, costUsd: cost, rounds: round + 1 }
  }
  return { ok: false, answer: '', reason: 'too_many_rounds', outcomes, costUsd: cost, rounds: MAX_ROUNDS }
}
