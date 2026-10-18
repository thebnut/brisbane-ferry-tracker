/** The Ask box's answer: text, a friendly note for any AI limit, and the rows as shared departure cards. */
import { type BadgeKind, DepartureCard, dayMarker, RouteTile } from '@bft/ui'
import type { AskDeparture, AskResult } from '../lib/ask.ts'

/** Minutes after midnight of a "7:42 pm" clock text, or null. */
function clockMinutes(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(text.trim())
  if (!m) return null
  const h = Number(m[1]) % 12
  return (m[3]?.toLowerCase() === 'pm' ? h + 12 : h) * 60 + Number(m[2])
}

/**
 * "(19/10)" markers for an answer row, as the boards show them (X6). Rows carry clock text only; the departure's day
 * comes from `inMinutes`, and an arrival whose clock is earlier than the departure's is the next day.
 */
export function askDayMarkers(d: AskDeparture, nowMs: number) {
  const dep = clockMinutes(d.departs)
  const arr = d.arrives ? clockMinutes(d.arrives) : null
  // The instant whose Brisbane clock (UTC+10, no DST) shows `departs`, nearest to now + inMinutes.
  const approxS = Math.floor(nowMs / 1000) + d.inMinutes * 60
  const localMin = Math.floor(((approxS + 10 * 3600) % 86400) / 60)
  const depS =
    dep == null ? approxS : approxS + (((((dep - localMin + 720) % 1440) + 1440) % 1440) - 720) * 60
  const arrS = dep != null && arr != null ? depS + ((arr - dep + 1440) % 1440) * 60 : null
  return { dep: dayMarker(depS, nowMs), arr: arrS != null ? dayMarker(arrS, nowMs) : null }
}

export function askRowProps(d: AskDeparture, nowMs = Date.now()) {
  const markers = askDayMarkers(d, nowMs)
  const cancelled = d.status === 'cancelled'
  const skipped = d.status === 'skipped'
  const badges: BadgeKind[] = cancelled
    ? ['cancelled']
    : skipped
      ? ['skipped']
      : d.status === 'live'
        ? ['live']
        : d.status === 'unknown'
          ? ['unknown']
          : ['scheduled']
  return {
    time: d.departs,
    dayMarker: markers.dep,
    arrival: d.arrives && !skipped ? { time: d.arrives, dayMarker: markers.arr } : null,
    badges,
    service: `${d.route} to ${d.headsign}`.toUpperCase(),
    note: skipped ? 'Not stopping here' : d.platform ? `Platform ${d.platform}` : null,
    // No countdown for a service you can't board.
    minutes: cancelled || skipped ? null : d.inMinutes,
    cancelled,
    boardable: !cancelled && !skipped,
  }
}

/** Rendered only after the visitor asks (never on the server), so `nowMs` defaults to the device clock. */
export default function AskAnswer({ result, nowMs = Date.now() }: { result: AskResult; nowMs?: number }) {
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite">
      <p
        data-ask-source={result.source}
        className="rounded-card bg-white/90 px-4 py-3 text-[15px] leading-relaxed shadow-card dark:bg-night-card"
      >
        {result.answer}
      </p>
      {result.notice ? (
        <p
          role="status"
          data-ask-notice
          className="rounded-card border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-night-card dark:text-amber-200"
        >
          {result.notice}
        </p>
      ) : null}
      {result.departures.map((d, i) => {
        const p = askRowProps(d, nowMs)
        return (
          <DepartureCard
            key={`${d.tripInstance}:${d.departs}`}
            time={p.time}
            dayMarker={p.dayMarker}
            arrival={p.arrival}
            badges={p.badges}
            service={p.service}
            note={p.note}
            minutes={p.minutes}
            cancelled={p.cancelled}
            highlighted={i === 0 && p.boardable}
            leading={<RouteTile route={d.route} size="sm" />}
          />
        )
      })}
      {result.source === 'llm' ? (
        <p className="text-xs text-sched-text">Answered with help from AI, using only live Translink data.</p>
      ) : null}
    </div>
  )
}
