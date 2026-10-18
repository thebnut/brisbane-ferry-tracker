/** The Ask box's answer: text, a friendly note for any AI limit, and the rows as shared departure cards. */
import { DepartureCard, RouteTile } from '@bft/ui'
import type { AskDeparture, AskResult } from '../lib/ask.ts'

export function askRowProps(d: AskDeparture) {
  const cancelled = d.status === 'cancelled'
  return {
    time: d.departs,
    arrival: d.arrives ? { time: d.arrives } : null,
    badges: cancelled
      ? (['cancelled'] as const)
      : d.status === 'live'
        ? (['live'] as const)
        : (['scheduled'] as const),
    service: `${d.route} to ${d.headsign}`.toUpperCase(),
    note: d.platform ? `Platform ${d.platform}` : null,
    minutes: cancelled ? null : d.inMinutes,
    cancelled,
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
            {...p}
            badges={[...p.badges]}
            highlighted={i === 0 && !p.cancelled}
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
