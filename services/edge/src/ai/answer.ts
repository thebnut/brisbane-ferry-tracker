/**
 * Deterministic answers for parsed intents (no LLM, $0). The answer text is always computed from live data;
 * only the intent is ever cached.
 */
import {
  type AlertsResponse,
  brisbaneDate,
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

/**
 * "4:33 am tomorrow (19/10)" for a time on a later Brisbane calendar day, the same rule as the cards' (19/10) marker
 * (@bft/ui dayMarker, R2-X6b); "tomorrow" only for the next day, else just the date.
 */
export function timeWithDay(epochS: number, nowS: number): string {
  const day = brisbaneDate(epochS * 1000)
  const today = brisbaneDate(nowS * 1000)
  if (day <= today) return fmtTime(epochS)
  const tomorrow = brisbaneDate(nowS * 1000 + 86_400_000) === day
  return `${fmtTime(epochS)} ${tomorrow ? 'tomorrow ' : ''}(${day.slice(6, 8)}/${day.slice(4, 6)})`
}

function describe(d: Departure, nowS: number): string {
  const dep = d.estDep ?? d.schedDep
  const mins = Math.round((dep - nowS) / 60)
  const time = timeWithDay(dep, nowS)
  const when = mins <= 0 ? 'leaving now' : mins < 60 ? `in ${mins} min (${time})` : `at ${time}`
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

/**
 * How long a place's other platforms may take once the first has answered (R11-A1): one slow platform mustn't hold
 * the answer up, so it goes out with what has arrived, and says so.
 */
export const PLATFORM_GRACE_MS = 1_500

/**
 * The most a place's fan-out waits in all, from its start (Codex r1): failed platforms plus one that never answers
 * still end in a reply. Under the apps' 8 s client deadline.
 */
export const PLATFORM_DEADLINE_MS = 5_000

const sleep = (ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const p = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  return { p, cancel: () => clearTimeout(timer) }
}

/**
 * Departures for every stop of a place, in parallel. Waits for the first good answer, then up to `graceMs` for the
 * rest, and never past `deadlineMs` from the start; anything that fails or is still out is null. With one stop this
 * is just that read, as before.
 */
async function fanOut(
  reads: Array<() => Promise<Response>>,
  graceMs: number,
  deadlineMs: number,
): Promise<Array<DeparturesResponse | null>> {
  const out: Array<DeparturesResponse | null> = reads.map(() => null)
  const settled = reads.map((read, i) =>
    read()
      .then(async (res) => {
        if (res.ok) out[i] = (await res.json()) as DeparturesResponse
      })
      .catch(() => undefined),
  )
  if (reads.length === 1) {
    await settled[0]
    return out
  }
  const deadline = sleep(deadlineMs)
  const all = Promise.all(settled)
  // The first good answer starts the grace period; if none comes, wait for everything, up to the deadline.
  const firstGood = new Promise<void>((resolve) => {
    for (const p of settled) p.then(() => out.some((b) => b != null) && resolve())
    all.then(() => resolve())
  })
  await Promise.race([firstGood, deadline.p])
  const grace = sleep(graceMs)
  if (out.some((b) => b != null)) await Promise.race([all, grace.p, deadline.p])
  grace.cancel()
  deadline.cancel()
  // A late answer must not change the result after it's returned.
  return [...out]
}

export async function answerIntent(
  intent: Intent,
  fetchApi: InternalFetch,
  nowS: number,
  opts: { platformGraceMs?: number; platformDeadlineMs?: number } = {},
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
      const fromKeys = from.stopKeys && from.stopKeys.length > 1 ? from.stopKeys : [from.key]
      const grouped = fromKeys.length > 1
      // Filter by route before limiting: fetch a wider window when a route is requested (Codex review round 2).
      const q = new URLSearchParams({ limit: '5' })
      if (intent.route) q.set('route', intent.route)
      // Towards the city or away from it: by each service's stops after this one (THE-117).
      const cityDir = intent.kind === 'departures_at' ? intent.city : undefined
      if (cityDir) q.set('city', cityDir)
      // From the city: each line says which city stop it leaves from.
      const fromCity = intent.kind === 'next_departure' && intent.city === 'out'
      if (to) q.set('to', (to.stopKeys && to.stopKeys.length > 1 ? to.stopKeys : [to.key]).join(','))
      const loaded = await fanOut(
        fromKeys.map((k) => () => fetchApi(`/v1/${mode}/stops/${encodeURIComponent(k)}/departures?${q}`)),
        opts.platformGraceMs ?? PLATFORM_GRACE_MS,
        opts.platformDeadlineMs ?? PLATFORM_DEADLINE_MS,
      )
      const bodies = loaded.filter((b): b is DeparturesResponse => b != null)
      const first = bodies[0]
      if (!first) return { answer: `Sorry, I couldn't load departures for ${from.name} right now.` }
      // A place's platforms answer separately: merge, earliest first (the effective time each card shows).
      const seen = new Set<string>()
      const boardAt = new Map<Departure, string>()
      for (const b of bodies) for (const d of b.departures) boardAt.set(d, b.stop.name)
      const byTime = (a: Departure, b: Departure) => (a.estDep ?? a.schedDep) - (b.estDep ?? b.schedDep)
      const all = bodies.flatMap((b) => b.departures)
      // A service through several city stops is listed once, from the first of them it reaches.
      if (fromCity) all.sort(byTime)
      const rows = all
        .filter((d) => d.status !== 'skipped' && !seen.has(d.tripInstance) && !!seen.add(d.tripInstance))
        .sort(byTime)
      const stopName = grouped ? from.name : first.stop.name
      const toName = to
        ? to.stopKeys && to.stopKeys.length > 1
          ? to.name
          : (first.to?.name ?? to.name)
        : null
      const toRef = first.to && toName ? { ...first.to, name: toName } : first.to
      // The route restriction is part of the claim, positive or negative (Codex review round 5).
      const what = intent.route ? `route ${intent.route} ${PLURAL[mode]}` : `${PLURAL[mode]}`
      const towards = cityDir === 'in' ? ' to the city' : cityDir === 'out' ? ' away from the city' : ''
      const head = to ? `${what} from ${stopName} to ${toName}` : `${what} from ${stopName}${towards}`
      const note = intent.kind === 'next_departure' && intent.note ? ` ${intent.note}` : ''
      // A platform that didn't answer in time leaves a gap: say so rather than claim these are the next ones.
      const partial =
        bodies.length < fromKeys.length
          ? fromCity
            ? " Some city stops didn't answer in time, so there may be earlier services."
            : ` Some platforms at ${stopName} didn't answer in time, so there may be earlier services.`
          : ''
      // "None go to the city" is about stopping patterns, so it says so rather than "no services".
      const none = cityDir
        ? `No upcoming ${what} from ${stopName} ${cityDir === 'in' ? 'go on to a city stop' : 'head away from the city'}.`
        : `No upcoming ${head} found.`
      if (rows.length === 0)
        return {
          answer: `${none}${note}${partial}`,
          stop: { mode, key: from.key, name: stopName },
          to: toRef,
        }
      const lines = rows
        .slice(0, 3)
        .map((d) => `${describe(d, nowS)}${fromCity && boardAt.get(d) ? `, from ${boardAt.get(d)}` : ''}`)
      const live = bodies.every((b) => b.rtState === 'live')
      const caveat = live ? '' : ' Live times are unavailable, so these are timetabled.'
      return {
        answer: `Next ${head}: ${lines.join('; ')}.${note}${caveat}${partial}`,
        departures: rows.slice(0, 5).map((d) => slimDeparture(d, nowS)),
        rows: rows.slice(0, 5),
        stop: { mode, key: from.key, name: stopName },
        to: toRef,
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
