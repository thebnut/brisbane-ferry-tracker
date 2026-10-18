/** A stop's departure list (B-Departures): polls /v1 every 15 s, banners, loading/empty/error states. */
import type { Alert, Departure, DeparturesResponse } from '@bft/core/contract'
import {
  brisbaneDateKey,
  dayMarker,
  ErrorState,
  formatClock,
  MoreButton,
  RouteDepartureCard,
  RouteTile,
  routeTileVariant,
  SkeletonRows,
} from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-bus.svg?url'
import { useState } from 'react'
import { Link } from 'react-router'
import { rowLabel, rowViews } from '../lib/departures.ts'
import { stopHref, tripHref } from '../lib/stops.ts'

export const linkRenderer = ({
  href,
  className,
  children,
  label,
}: {
  href: string
  className: string
  children: React.ReactNode
  label?: string
}) => (
  <Link to={href} className={className} aria-label={label} prefetch="intent">
    {children}
  </Link>
)

export interface DepartureListProps {
  stopId: string
  data: DeparturesResponse | undefined
  isError: boolean
  onRetry: () => void
  nowMs: number
  alerts: Alert[]
  routes?: ReadonlySet<string> | null
  /** Show this many, with "More departures" for the rest (desktop boards). */
  initialCount?: number
  /** Offline: an empty list means no usable timetable copy, never "no departures" (R2-B6). */
  offline?: boolean
  /** A saved stop (its timetable copy ran out rather than never existed). */
  saved?: boolean
  /** This device has a timetable copy for the stop, now run out (a stop viewed before, saved or not). */
  copyRanOut?: boolean
}

/** True when every row is on a later Brisbane day (nothing more tonight). */
function allTomorrow(rows: Departure[], nowMs: number): boolean {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(nowMs)
  return (
    rows.length > 0 &&
    rows.every(
      (d) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(
          (d.estDep ?? d.schedDep) * 1000,
        ) > today,
    )
  )
}

/**
 * Why a board is empty, honestly (R2-B7): the response covers the service days in `serviceDates` (today, plus
 * tomorrow when it is in the timetable), so say which days have no buses rather than "the next day of timetable".
 */
export function noneDue(serviceDates: string[], nowMs: number, filtered: boolean): string {
  const what = filtered ? 'No buses on this route' : 'No buses'
  const today = brisbaneDateKey(nowMs).replaceAll('-', '')
  if (!serviceDates.some((d) => d > today)) return `${what} from this stop for the rest of today.`
  return `${what} from this stop for the rest of today or tomorrow ${dayMarker(nowMs / 1000 + 86_400, nowMs)}.`
}

export function DepartureList({
  stopId,
  data,
  isError,
  onRetry,
  nowMs,
  alerts,
  routes,
  initialCount,
  offline,
  saved,
  copyRanOut,
}: DepartureListProps) {
  const [expanded, setExpanded] = useState(false)
  if (!data) {
    if (isError)
      return (
        <ErrorState title="Live times aren't coming through" onRetry={onRetry}>
          TransLink's live feed didn't answer. We'll keep trying every 15 seconds.
        </ErrorState>
      )
    return <SkeletonRows />
  }
  const views = rowViews(data.departures, nowMs, { alerts, routes })
  // A set-down-only stop's own data says so, online or offline.
  const boardAt = data.stop.boardAt
  // Offline, an empty board (filtered or not) only means the copies on hand have run out (Codex review).
  if (views.length === 0 && offline && !boardAt) {
    return (
      <div
        data-empty="offline"
        className="flex flex-col items-center gap-3 rounded-card bg-white/90 px-6 py-8 text-center shadow-card dark:bg-night-card"
        role="status"
      >
        <img src={emblem} alt="" width={96} height={96} className="opacity-90" />
        <h2 className="text-xl font-extrabold">
          {routes?.size
            ? 'Offline: no saved times for this route'
            : saved || copyRanOut
              ? 'Offline: no more times in the saved timetable'
              : 'Offline: no saved timetable for this stop'}
        </h2>
        <p className="text-sm text-sched-text">
          Buses may still be running. Times come back when you reconnect.
          {saved ? null : ' Save a stop to My stops to keep its timetable for offline use.'}
        </p>
      </div>
    )
  }
  if (views.length === 0 && boardAt && !routes?.size) {
    // A set-down-only stop (ADDENDUM 2: UQ Lakes station 1882): buses only drop off here, so its empty board is
    // correct; point to the stops under the same station where they pick up.
    return (
      <div
        data-empty="drop-off-only"
        className="flex flex-col items-center gap-3 rounded-card bg-white/90 px-6 py-8 text-center shadow-card dark:bg-night-card"
        role="status"
      >
        <img src={emblem} alt="" width={96} height={96} className="opacity-90" />
        <h2 className="text-xl font-extrabold">
          {boardAt.length ? 'Buses only drop off here' : 'No buses pick up here'}
        </h2>
        {boardAt.length ? (
          <>
            <p className="text-sm text-sched-text">Board at:</p>
            <ul className="flex flex-wrap justify-center gap-2" aria-label="Board at">
              {boardAt.map((s) => (
                <li key={s.key}>
                  <Link
                    to={stopHref(s.key)}
                    className="inline-block rounded-full border border-ferry-orange/30 bg-white px-3 py-1.5 text-sm font-semibold text-aqua-text hover:border-ferry-orange dark:bg-night-card dark:text-ferry-aqua-light"
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-sched-text">Buses only drop off at this stop.</p>
        )}
      </div>
    )
  }
  if (views.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-card bg-white/90 px-6 py-8 text-center shadow-card dark:bg-night-card"
        role="status"
      >
        <img src={emblem} alt="" width={96} height={96} className="opacity-90" />
        <h2 className="text-xl font-extrabold">
          {routes?.size ? 'No buses on this route soon' : 'No buses due'}
        </h2>
        <p className="text-sm text-sched-text">{noneDue(data.serviceDates, nowMs, !!routes?.size)}</p>
      </div>
    )
  }
  const tonightDone = allTomorrow(data.departures, nowMs)
  const first = views[0]
  // The "First bus tomorrow" card is the first row, so the list starts after it (R2-B9).
  const rest = tonightDone && first ? views.slice(1) : views
  const shown = initialCount && !expanded ? rest.slice(0, initialCount) : rest
  return (
    <>
      {tonightDone && first ? (
        <section className="flex flex-col items-center gap-3 px-2 py-4 text-center" aria-labelledby="no-more">
          <img src={emblem} alt="" width={112} height={112} className="opacity-90" />
          <h2 id="no-more" className="text-[22px] font-extrabold">
            No more buses tonight
          </h2>
          <p className="text-[15px] text-gray-700 dark:text-night-text/80">First bus tomorrow:</p>
          <div className="flex w-full items-center gap-3 rounded-card bg-white/90 px-4 py-3.5 shadow-card dark:bg-night-card">
            <RouteTile
              route={first.departure.route.short}
              variant={routeTileVariant(first.departure.route.short, first.departure.route.long)}
              size="lg"
            />
            <span className="flex-1 text-left text-base font-bold">{first.departure.headsign}</span>
            <span className="flex flex-col items-end">
              <span className="text-[22px] font-extrabold tabular">
                {formatClock(first.departure.schedDep)}
              </span>
              {first.dayMarker ? (
                <span className="text-[13px] font-bold text-ferry-orange-deep">{first.dayMarker}</span>
              ) : null}
            </span>
          </div>
        </section>
      ) : null}
      <ol className="flex flex-col gap-2.5" aria-label="Departures">
        {shown.map((v) => (
          <li key={v.key}>
            <RouteDepartureCard
              route={v.departure.route.short}
              routeLong={v.departure.route.long}
              destination={v.departure.headsign}
              status={v.departure.status}
              note={v.note}
              noteTone={v.noteTone}
              minutes={v.minutes}
              time={v.time}
              dayMarker={v.dayMarker}
              platform={v.departure.platform && v.departure.stopId !== stopId ? v.departure.platform : null}
              highlighted={v.highlighted}
              href={tripHref(v.departure.tripInstance, stopId)}
              label={rowLabel(v)}
              renderLink={linkRenderer}
            />
          </li>
        ))}
      </ol>
      {initialCount && rest.length > initialCount ? (
        <MoreButton onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Fewer departures' : 'More departures'}
        </MoreButton>
      ) : null}
    </>
  )
}
