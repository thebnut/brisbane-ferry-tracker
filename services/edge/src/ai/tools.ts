/**
 * Executes the shared tools (`@bft/core` TOOLS) against our own /v1 routes in-process, for both the LLM
 * fallback and the read-only /mcp server. Results are trimmed to what an answer needs.
 */
import {
  type AlertsResponse,
  type Departure,
  type DeparturesResponse,
  GetAlertsInput,
  GetDeparturesInput,
  GetTripInput,
  SearchStopsInput,
  type ToolName,
} from '@bft/core'
import { searchStops } from './resolver.ts'

export type InternalFetch = (path: string) => Promise<Response>

export interface ToolContext {
  fetch: InternalFetch
  indexes: Parameters<typeof searchStops>[0]
}

export interface ToolOutcome {
  tool: ToolName
  ok: boolean
  input?: unknown
  result: unknown
  departures?: Departure[]
}

const TIME = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Brisbane',
  hour: 'numeric',
  minute: '2-digit',
})
export const fmtTime = (epochS: number) => TIME.format(new Date(epochS * 1000)).replace(' ', ' ')

/** A compact row for the model: enough to answer, small enough to keep input tokens low. */
export function slimDeparture(d: Departure, nowS: number) {
  const dep = d.estDep ?? d.schedDep
  return {
    tripInstance: d.tripInstance,
    route: d.route.short,
    headsign: d.headsign,
    platform: d.platform,
    departs: fmtTime(dep),
    inMinutes: Math.round((dep - nowS) / 60),
    arrives: (d.estArrTo ?? d.schedArrTo) ? fmtTime((d.estArrTo ?? d.schedArrTo) as number) : null,
    status: d.status,
  }
}

export async function runTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
  nowS: number,
): Promise<ToolOutcome> {
  switch (name) {
    case 'search_stops': {
      const p = SearchStopsInput.safeParse(input)
      if (!p.success) return { tool: 'search_stops', ok: false, result: { error: p.error.message } }
      return { tool: 'search_stops', ok: true, result: searchStops(ctx.indexes, p.data.query, p.data.mode) }
    }
    case 'get_departures': {
      const p = GetDeparturesInput.safeParse(input)
      if (!p.success) return { tool: 'get_departures', ok: false, result: { error: p.error.message } }
      const q = new URLSearchParams({ limit: String(p.data.limit) })
      if (p.data.toKey) q.set('to', p.data.toKey)
      const res = await ctx.fetch(
        `/v1/${p.data.mode}/stops/${encodeURIComponent(p.data.stopKey)}/departures?${q}`,
      )
      if (!res.ok) return { tool: 'get_departures', ok: false, result: { error: `HTTP ${res.status}` } }
      const body = (await res.json()) as DeparturesResponse
      return {
        tool: 'get_departures',
        ok: true,
        input: p.data,
        departures: body.departures,
        result: {
          stop: body.stop.name,
          to: body.to?.name ?? null,
          rtState: body.rtState,
          departures: body.departures.map((d) => slimDeparture(d, nowS)),
        },
      }
    }
    case 'get_trip': {
      const p = GetTripInput.safeParse(input)
      if (!p.success) return { tool: 'get_trip', ok: false, result: { error: p.error.message } }
      const res = await ctx.fetch(`/v1/${p.data.mode}/trips/${encodeURIComponent(p.data.tripInstance)}`)
      if (!res.ok) return { tool: 'get_trip', ok: false, result: { error: `HTTP ${res.status}` } }
      return { tool: 'get_trip', ok: true, result: await res.json() }
    }
    case 'get_alerts': {
      const p = GetAlertsInput.safeParse(input)
      if (!p.success) return { tool: 'get_alerts', ok: false, result: { error: p.error.message } }
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(p.data)) if (v) q.set(k, v)
      const res = await ctx.fetch(`/v1/alerts?${q}`)
      if (!res.ok) return { tool: 'get_alerts', ok: false, result: { error: `HTTP ${res.status}` } }
      const body = (await res.json()) as AlertsResponse
      return {
        tool: 'get_alerts',
        ok: true,
        result: body.alerts.slice(0, 8).map((a) => ({
          header: a.header,
          summary: a.summary ?? a.description?.slice(0, 300),
          routes: a.routes,
        })),
      }
    }
    default:
      return { tool: 'search_stops', ok: false, result: { error: `unknown tool ${name}` } }
  }
}
