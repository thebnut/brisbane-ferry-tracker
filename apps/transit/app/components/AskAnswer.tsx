/** The Ask box's answer: text, a friendly note for any AI limit, and the rows as shared departure cards. */
import { type BadgeKind, DepartureCard, RouteTile } from '@bft/ui'
import type { AskDeparture, AskResult } from '../lib/ask.ts'

export function askRowProps(d: AskDeparture) {
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
    arrival: d.arrives && !skipped ? { time: d.arrives } : null,
    badges,
    service: `${d.route} to ${d.headsign}`.toUpperCase(),
    note: skipped ? 'Not stopping here' : d.platform ? `Platform ${d.platform}` : null,
    // No countdown for a service you can't board.
    minutes: cancelled || skipped ? null : d.inMinutes,
    cancelled,
    boardable: !cancelled && !skipped,
  }
}

export default function AskAnswer({ result }: { result: AskResult }) {
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
        const p = askRowProps(d)
        return (
          <DepartureCard
            key={`${d.tripInstance}:${d.departs}`}
            time={p.time}
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
