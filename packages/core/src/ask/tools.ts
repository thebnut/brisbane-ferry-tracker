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
 * Grounding check: every departure the model cites must appear in a get_departures result from this request,
 * and an answer with no tool calls is rejected.
 */
export function isGrounded(
  cited: Array<{ tripInstance: string }>,
  toolResults: Array<{ tool: ToolName; departures?: Array<{ tripInstance: string }> }>,
): boolean {
  if (toolResults.length === 0) return false
  const seen = new Set<string>()
  for (const r of toolResults) for (const d of r.departures ?? []) seen.add(d.tripInstance)
  return cited.every((c) => seen.has(c.tripInstance))
}
