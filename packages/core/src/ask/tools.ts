/**
 * Tool definitions shared by the /v1/ask LLM fallback and the read-only /mcp server (ADR-0008).
 * The model may only answer from these tools' results.
 */
import { z } from 'zod'
import { Mode } from '../contract/index.ts'

export const SearchStopsInput = z.object({
  query: z.string().min(1).max(80).describe('Stop or station name, or a bus stop number'),
  mode: Mode.optional().describe('Restrict to one mode'),
})
export const GetDeparturesInput = z.object({
  mode: Mode,
  stopKey: z.string().describe('Stop key from search_stops'),
  toKey: z.string().optional().describe('Destination stop key from search_stops'),
  limit: z.number().int().min(1).max(10).default(5),
})
export const GetTripInput = z.object({ mode: Mode, tripInstance: z.string() })
export const GetAlertsInput = z.object({
  mode: Mode.optional(),
  route: z.string().optional(),
  stop: z.string().optional(),
})

export const TOOLS = {
  search_stops: { description: 'Find stops or stations by name or number.', input: SearchStopsInput },
  get_departures: {
    description:
      'Live and scheduled departures from a stop, optionally only services that reach a destination.',
    input: GetDeparturesInput,
  },
  get_trip: {
    description: 'Stopping pattern, times and vehicle for one trip instance.',
    input: GetTripInput,
  },
  get_alerts: {
    description: 'Current service alerts, filtered by mode, route or stop.',
    input: GetAlertsInput,
  },
} as const

export type ToolName = keyof typeof TOOLS

/** Anthropic Messages API tool definitions (JSON Schema). */
export function anthropicTools(): Array<{ name: ToolName; description: string; input_schema: unknown }> {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    name,
    description: TOOLS[name].description,
    input_schema: z.toJSONSchema(TOOLS[name].input),
  }))
}

/**
 * The LLM never writes answer text (Codex review rounds 1-2: prose can't be verified). It must finish by calling
 * `final_answer` with references to rows returned by tools in this request, or a predefined reason. The server
 * renders every word the user sees from those rows.
 */
export const FinalAnswerInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('departures'),
    refs: z
      .array(z.string())
      .min(1)
      .max(5)
      .describe('ref values of the departure rows that answer the question'),
  }),
  z.object({
    kind: z.literal('alerts'),
    refs: z.array(z.string()).max(5).describe('ref values of relevant alerts; empty means none reported'),
  }),
  z.object({
    kind: z.literal('cannot_answer'),
    reason: z.enum(['trip_planning', 'unknown_stop', 'no_service', 'out_of_scope']),
  }),
])
export type FinalAnswer = z.infer<typeof FinalAnswerInput>

export const FINAL_ANSWER_TOOL = {
  name: 'final_answer' as const,
  description:
    'Finish by referencing the rows that answer the question (departures or alerts, by their ref), or give a reason you cannot answer. Do not write the answer yourself.',
  input_schema: z.toJSONSchema(FinalAnswerInput),
}

export interface Evidence {
  departures: ReadonlySet<string>
  alerts: ReadonlySet<string>
  /** At least one get_alerts call succeeded with fresh data in this request. */
  alertsChecked: boolean
}

/** A final answer is grounded only if every ref was returned by a successful tool call in this request. */
export function isGroundedAnswer(final: FinalAnswer, ev: Evidence): boolean {
  if (final.kind === 'departures') return final.refs.every((r) => ev.departures.has(r))
  if (final.kind === 'alerts') return ev.alertsChecked && final.refs.every((r) => ev.alerts.has(r))
  return true
}
