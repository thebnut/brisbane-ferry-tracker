/**
 * Deterministic answers for parsed intents (no LLM, $0). The answer text is always computed from live data;
 * only the intent is ever cached.
 */
import type { Departure, DeparturesResponse, Intent, Mode } from '@bft/core'
import { fmtTime, type InternalFetch, slimDeparture } from './tools.ts'

export interface AskAnswer {
  answer: string
  departures?: ReturnType<typeof slimDeparture>[]
  rows?: Departure[]
  stop?: { mode: Mode; key: string; name: string }
  to?: { key: string; name: string } | null
}

const MODE_WORD: Record<Mode, string> = { ferry: 'ferry', train: 'train', bus: 'bus', tram: 'tram' }

function describe(d: Departure, nowS: number): string {
  const dep = d.estDep ?? d.schedDep
  const mins = Math.round((dep - nowS) / 60)
  const when =
    mins <= 0 ? 'leaving now' : mins < 60 ? `in ${mins} min (${fmtTime(dep)})` : `at ${fmtTime(dep)}`
  const status =
    d.status === 'cancelled'
      ? ' (cancelled)'
      : d.status === 'live'
        ? ' (live)'
        : d.status === 'unknown'
          ? ' (status unknown)'
          : ''
  const plat = d.platform ? `, platform ${d.platform}` : ''
  return `${d.route.short} to ${d.headsign} ${when}${plat}${status}`
}

export async function answerIntent(
  intent: Intent,
  fetchApi: InternalFetch,
  nowS: number,
): Promise<AskAnswer> {
  switch (intent.kind) {
    case 'trip_plan_unsupported':
      return {
        answer:
          'I can\'t plan multi-step journeys yet. Try asking for the next service between two stops, e.g. "next train from Bowen Hills to the airport".',
      }
    case 'next_departure':
    case 'departures_at': {
      const from = intent.kind === 'next_departure' ? intent.from : intent.at
      const to = intent.kind === 'next_departure' ? intent.to : undefined
      const mode = from.mode
      const q = new URLSearchParams({ limit: '5' })
      if (to) q.set('to', to.key)
      const res = await fetchApi(`/v1/${mode}/stops/${encodeURIComponent(from.key)}/departures?${q}`)
      if (!res.ok) return { answer: `Sorry, I couldn't load departures for ${from.name} right now.` }
      const body = (await res.json()) as DeparturesResponse
      let rows = body.departures.filter((d) => d.status !== 'skipped')
      if (intent.route) rows = rows.filter((d) => d.route.short.toUpperCase() === intent.route)
      const head = to
        ? `${MODE_WORD[mode]}s from ${body.stop.name} to ${body.to?.name ?? to.name}`
        : `${MODE_WORD[mode]}s from ${body.stop.name}`
      if (rows.length === 0)
        return {
          answer: `No upcoming ${head} found.`,
          stop: { mode, key: from.key, name: body.stop.name },
          to: body.to,
        }
      const lines = rows.slice(0, 3).map((d) => describe(d, nowS))
      const caveat = body.rtState === 'live' ? '' : ' Live times are unavailable, so these are timetabled.'
      return {
        answer: `Next ${head}: ${lines.join('; ')}.${caveat}`,
        departures: rows.slice(0, 5).map((d) => slimDeparture(d, nowS)),
        rows: rows.slice(0, 5),
        stop: { mode, key: from.key, name: body.stop.name },
        to: body.to,
      }
    }
    case 'route_status': {
      const q = new URLSearchParams({ route: intent.route })
      if (intent.mode) q.set('mode', intent.mode)
      const res = await fetchApi(`/v1/alerts?${q}`)
      const alerts = res.ok
        ? ((await res.json()) as { alerts: Array<{ header: string; summary?: string }> }).alerts
        : []
      return {
        answer:
          alerts.length > 0
            ? `Route ${intent.route}: ${alerts.map((a) => a.summary ?? a.header).join(' ')}`
            : `No disruptions are reported for route ${intent.route}. For a specific service's live time, ask for the next ${intent.mode ?? 'service'} from your stop.`,
      }
    }
    case 'alerts': {
      const q = new URLSearchParams()
      if (intent.mode) q.set('mode', intent.mode)
      const res = await fetchApi(`/v1/alerts?${q}`)
      let alerts = res.ok
        ? ((await res.json()) as { alerts: Array<{ header: string; summary?: string; routes: string[] }> })
            .alerts
        : []
      if (intent.line) {
        const line = intent.line.toLowerCase()
        alerts = alerts.filter(
          (a) => a.header.toLowerCase().includes(line) || a.routes.some((r) => r.toLowerCase() === line),
        )
      }
      return {
        answer:
          alerts.length === 0
            ? `No current alerts${intent.line ? ` for ${intent.line}` : intent.mode ? ` for ${intent.mode}s` : ''}.`
            : `${alerts.length} alert${alerts.length > 1 ? 's' : ''}: ${alerts
                .slice(0, 3)
                .map((a) => a.summary ?? a.header)
                .join(' | ')}`,
      }
    }
  }
}
