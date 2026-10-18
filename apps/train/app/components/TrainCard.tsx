/**
 * One departure in the T-Departures look: platform tile (orange "NOW n" for a platform change), LIVE/GPS/EXPRESS
 * badges, time → arrival, countdown chip, the stopping-pattern strip in the line colour with hollow dots for stations
 * an express runs through, and the line label. Cancelled rows use the dashed muted card.
 */
import { DepartureCard, LineChip, PlatformTile, StoppingPattern } from '@bft/ui'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'
import type { TrainCard as Model } from '../lib/departures.ts'
import { lineLabel } from '../lib/lineNames.ts'

export function tripHref(card: Model, from: string, to: string | null) {
  const q = new URLSearchParams({ from })
  if (to) q.set('to', to)
  return `${at('/trip')}/${encodeURIComponent(card.tripInstance)}?${q}`
}

export function TrainCard({
  card,
  from,
  to,
  highlighted,
}: {
  card: Model
  from: string
  to: string | null
  highlighted?: boolean
}) {
  if (card.cancelled) {
    return (
      <article
        data-cancelled="true"
        data-testid="departure"
        className="flex items-center gap-3 rounded-card border border-dashed border-[#D1A08A] bg-white/75 px-3.5 py-3 dark:bg-night-card/70"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-14 shrink-0 items-center justify-center rounded-[10px] bg-sched-bg text-[13px] font-bold text-sched-text"
        >
          —
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[#B91C1C] px-2 py-0.5 text-[11px] font-bold text-white">
              CANCELLED
            </span>
            <span className="text-xs text-gray-600 dark:text-night-text/70">{lineLabel(card.line.name)}</span>
          </span>
          <span className="text-lg font-bold text-sched-text tabular line-through">
            {card.time}
            <span className="sr-only"> to {card.headsign}, cancelled</span>
          </span>
        </span>
      </article>
    )
  }
  return (
    <div data-testid="departure" data-platform-change={card.scheduledPlatform ? 'true' : undefined}>
      <DepartureCard
        time={card.time}
        dayMarker={card.dayMarker}
        arrival={card.arrival}
        journey={card.journey}
        badges={card.badges}
        service={card.express ? 'EXPRESS' : undefined}
        express={card.express}
        note={card.note}
        delay={card.delay}
        minutes={card.minutes}
        highlighted={highlighted}
        leading={<PlatformTile platform={card.platform} scheduledPlatform={card.scheduledPlatform} />}
        href={tripHref(card, from, to)}
        linkAs={Link}
        label={card.label}
        below={
          <div className="flex flex-col gap-1.5">
            <StoppingPattern
              compact
              stops={card.strip}
              color={card.line.color}
              label={`Stops from here to ${card.strip.at(-1)?.name ?? card.headsign}`}
            />
            <p className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-night-text/70">
              <span className="truncate">
                <LineChip name={lineLabel(card.line.name)} color={card.line.color} /> · to {card.headsign}
              </span>
              {card.skips > 0 ? <span className="shrink-0">skips {card.skips}</span> : null}
            </p>
          </div>
        }
      />
    </div>
  )
}
