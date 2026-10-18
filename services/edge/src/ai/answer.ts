/**
 * Deterministic answers for parsed intents (no LLM, $0). The answer text is always computed from live data;
 * only the intent is ever cached.
 */
import {
  type AlertsResponse,
  type Departure,
  type DeparturesResponse,
  type Intent,
  type Mode,
  routeKey,
} from '@bft/core'
import { fmtTime, type InternalFetch, slimDeparture } from './tools.ts'

export interface AskAnswer {
  answer: string
  departures?: ReturnType<typeof slimDeparture>[]
  rows?: Departure[]
  stop?: { mode: Mode; key: string; name: string }
  to?: { key: string; name: string } | null
}

const PLURAL: Record<Mode, string> = { ferry: 'ferries', train: 'trains', bus: 'buses', tram: 'trams' }

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
      // Filter by route before limiting: fetch a wider window when a route is requested (Codex review round 2).
      const q = new URLSearchParams({ limit: '5' })
      if (intent.route) q.set('route', intent.route)
      if (to) q.set('to', to.key)
      const res = await fetchApi(`/v1/${mode}/stops/${encodeURIComponent(from.key)}/departures?${q}`)
      if (!res.ok) return { answer: `Sorry, I couldn't load departures for ${from.name} right now.` }
      const body = (await res.json()) as DeparturesResponse
      const rows = body.departures.filter((d) => d.status !== 'skipped')
      // The route restriction is part of the claim, positive or negative (Codex review round 5).
      const what = intent.route ? `route ${intent.route} ${PLURAL[mode]}` : `${PLURAL[mode]}`
      const head = to
        ? `${what} from ${body.stop.name} to ${body.to?.name ?? to.name}`
        : `${what} from ${body.stop.name}`
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
    case 'route_status':
    case 'alerts': {
      // Unavailable or stale alert data is never reported as an all-clear (Codex review round 2).
      const q = new URLSearchParams()
      if (intent.kind === 'route_status') q.set('route', intent.route)
      if (intent.mode) q.set('mode', intent.mode)
      const res = await fetchApi(`/v1/alerts?${q}`)
      if (!res.ok) return { answer: "Service alerts aren't available right now. Please try again shortly." }
      const body = (await res.json()) as AlertsResponse
      let alerts = body.alerts
      const unfiltered = alerts.length
      if (intent.kind === 'alerts' && intent.line) {
        const line = intent.line.toLowerCase()
        alerts = alerts.filter(
          // Alert routes are raw route_ids with version suffixes ("F1-4055"): compare by routeKey (Codex round 4).
          (a) =>
            a.header.toLowerCase().includes(line) || a.routes.some((r) => routeKey(r).toLowerCase() === line),
        )
      }
      const fresh = body.rtState === 'live'
      const subject =
        intent.kind === 'route_status'
          ? `route ${intent.route}`
          : intent.line
            ? intent.line
            : intent.mode
              ? PLURAL[intent.mode]
              : 'the network'
      // A line name is matched by text: if it matches nothing while other alerts exist, say exactly that instead of an
      // all-clear (the line may be named differently in the alert text).
      if (alerts.length === 0 && intent.kind === 'alerts' && intent.line && unfiltered > 0 && fresh)
        return {
          answer: `No current alert mentions ${intent.line}. There ${unfiltered === 1 ? 'is 1 other alert' : `are ${unfiltered} other alerts`}${intent.mode ? ` for ${PLURAL[intent.mode]}` : ''}: ask "${intent.mode ?? 'service'} alerts" to see them.`,
        }
      if (alerts.length === 0)
        return {
          answer: fresh
            ? `No current alerts for ${subject}.${intent.kind === 'route_status' ? ` For a service's live time, ask for the next ${intent.mode ?? 'service'} from your stop.` : ''}`
            : `I can't confirm alerts for ${subject} right now: the alert feed is out of date.`,
        }
      const list = alerts
        .slice(0, 3)
        .map((a) => a.summary ?? a.header)
        .join(' | ')
      return {
        answer: `${alerts.length} alert${alerts.length > 1 ? 's' : ''} for ${subject}: ${list}${fresh ? '' : ' (may be out of date)'}`,
      }
    }
  }
}
