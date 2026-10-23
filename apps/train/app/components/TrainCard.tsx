/**
 * One departure as the shared row (THE-118 PR 4): the platform on the line colour (an orange ring for a platform
 * change), the destination, the status line with one fact (the line, or "arr 7:31" when going somewhere), and the big
 * countdown. With a destination, wide rows add the arrival and journey. The stopping pattern is in trip detail.
 */
import { boardState, DepartureRow, type LinkRenderer, PlatformLineTile } from '@bft/ui'
import { Link, useLocation } from 'react-router'
import { at } from '../lib/base.ts'
import type { TrainCard as Model } from '../lib/departures.ts'

export function tripHref(card: Model, from: string, to: string | null) {
  const q = new URLSearchParams({ from })
  if (to) q.set('to', to)
  return `${at('/trip')}/${encodeURIComponent(card.tripInstance)}?${q}`
}

/** The row's link to its trip page, carrying the board's URL so the trip's back link returns here (THE-118 PR 6). */
function RowLink({ href, className, children, label }: Parameters<LinkRenderer>[0]) {
  const { pathname, search } = useLocation()
  return (
    <Link to={href} className={className} aria-label={label} state={boardState(pathname, search)}>
      {children}
    </Link>
  )
}
const linkRenderer: LinkRenderer = (props) => <RowLink {...props} />

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
  const going = to && card.arrival && !card.cancelled && !card.skipped
  return (
    <DepartureRow
      tile={
        <PlatformLineTile
          platform={card.platform}
          color={card.line.color}
          changedFrom={card.status.status === 'live' ? card.scheduledPlatform : null}
        />
      }
      destination={card.headsign}
      status={card.status}
      fact={card.fact}
      wideFact={card.lineFact}
      extra={
        going && card.arrival ? (
          <>
            <span className="text-charcoal dark:text-night-text">Arrives {card.arrival.time}</span>
            {card.journey ? <span className="text-xs font-normal">{card.journey}</span> : null}
          </>
        ) : null
      }
      minutes={card.minutes}
      time={card.time}
      highlighted={highlighted}
      href={tripHref(card, from, to)}
      renderLink={linkRenderer}
    />
  )
}
