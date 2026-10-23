/** One departure board: rows (5, then up to 13 with "More departures") linking to their trip pages, empty and error states. */
import type { Departure } from '@bft/core/contract'
import {
  boardState,
  cx,
  DayDivider,
  DepartureRow,
  dayDividers,
  EmptyState,
  ErrorState,
  type LinkRenderer,
  MoreButton,
  nextAlike,
  soonestIndex,
  useKept,
} from '@bft/ui'
import { Link, useLocation } from 'react-router'
import { rowModel } from '../lib/departures.ts'

/** A row's link to its trip page, carrying the board's URL so the trip's back link returns here (THE-118 PR 6). */
function RowLink({ href, className, children, label }: Parameters<LinkRenderer>[0]) {
  const { pathname, search } = useLocation()
  return (
    <Link to={href} className={className} aria-label={label} state={boardState(pathname, search)}>
      {children}
    </Link>
  )
}
const linkRenderer: LinkRenderer = (props) => <RowLink {...props} />

/** The row's tile (THE-118 PR 4): the service (F1, F11, F21) in a circle, orange for express, aqua for all stops. */
export function ServiceTile({ code, express = false }: { code: string; express?: boolean }) {
  return (
    <span
      data-tile="service"
      className={cx(
        'flex size-13 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white tabular max-[420px]:size-12',
        express ? 'bg-ferry-orange-aa' : 'bg-aqua-text',
      )}
    >
      <span className="sr-only">Service </span>
      {code}
    </span>
  )
}

export interface DepartureListProps {
  id: string
  /** Accessible board name, e.g. "Bulimba to Riverside". */
  label: string
  /** The return board beside the board on desktop: its own small title ("Riverside → Bulimba"). */
  title?: string
  departures: Departure[] | null
  nowMs: number
  loading: boolean
  error: boolean
  onRetry: () => void
  /** The departure's trip page. */
  tripHref: (d: Departure) => string
  /** Offline: an empty board means no usable timetable copy, never "finished for today" (R2-B6). */
  offline?: boolean
}

export function DepartureList({
  id,
  label,
  title,
  departures,
  nowMs,
  loading,
  error,
  onRetry,
  tripHref,
  offline,
}: DepartureListProps) {
  const [more, setMore] = useKept<boolean>(`more:${id}`, false)
  const list = departures ?? []
  const shown = list.slice(0, more ? 13 : 5)
  // The soonest ferry you can board gets the orange border (every board's rule); later days get a divider.
  const soonest = soonestIndex(shown)
  const dividers = dayDividers(
    shown.map((d) => d.estDep ?? d.schedDep),
    nowMs,
  )
  return (
    <section aria-label={label} className="flex flex-col gap-3" data-board={id}>
      {title ? (
        <h2 className="flex min-h-11 items-center text-base font-bold text-aqua-text dark:text-ferry-aqua-light">
          {title}
        </h2>
      ) : null}
      {departures == null && loading ? (
        <div className="rounded-card bg-white/90 px-4 py-8 text-center shadow-card" role="status">
          <span
            aria-hidden="true"
            className="mx-auto mb-3 block size-10 animate-spin rounded-full border-b-2 border-ferry-orange"
          />
          <span className="text-sched-text">Loading departures…</span>
        </div>
      ) : departures == null && error ? (
        <ErrorState onRetry={onRetry}>Check your connection. We'll keep trying.</ErrorState>
      ) : list.length === 0 && offline ? (
        <EmptyState title="Offline: no saved timetable for this trip">
          Ferries may still be running. Times come back when you reconnect.
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState title="No upcoming departures found">Services may have finished for today</EmptyState>
      ) : (
        <>
          <ol className="flex flex-col gap-3" aria-label="Departures">
            {shown.map((d, i) => {
              const r = rowModel(
                d,
                nowMs,
                d.status === 'cancelled'
                  ? nextAlike(list, i, (x) => x.route.short === d.route.short)
                  : undefined,
              )
              return (
                <li key={r.key}>
                  {dividers[i] ? <DayDivider>{dividers[i]}</DayDivider> : null}
                  <DepartureRow
                    tile={<ServiceTile code={r.code} express={r.express} />}
                    destination={r.destination}
                    status={r.status}
                    fact={r.fact}
                    wideFact={r.express ? 'express' : null}
                    extra={
                      r.arrival ? (
                        <>
                          <span className="text-charcoal dark:text-night-text">Arrives {r.arrival}</span>
                          {r.journey ? <span className="text-xs font-normal">{r.journey}</span> : null}
                        </>
                      ) : null
                    }
                    minutes={r.minutes}
                    time={r.time}
                    highlighted={i === soonest}
                    href={tripHref(d)}
                    renderLink={linkRenderer}
                  />
                </li>
              )
            })}
          </ol>
          {list.length > 5 ? (
            <MoreButton onClick={() => setMore(!more)} aria-expanded={more}>
              {more ? 'Show fewer' : `More departures (${Math.min(list.length - 5, 8)} more)`}
            </MoreButton>
          ) : null}
        </>
      )}
    </section>
  )
}
