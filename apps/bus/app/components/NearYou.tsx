/**
 * Bus home's Near you (THE-118 PR 8), once the device's position is known: the three nearest stops within 2 km (the
 * geohash tiles around the position, as /nearby; the position never leaves the browser), each with its next bus. Its
 * own chunk, loaded only then. Each row reports to the page header like a board.
 */
import { minutesUntil } from '@bft/ui'
import { awaitingSeedAnswer, usePageCheck } from '@bft/ui/connectivity'
import { NearPlaceRow, useReportLive } from '@bft/ui/mode-home'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { geohashEncode, geohashNeighbourhood, nearest } from '../lib/geo.ts'
import { useGeoTiles } from '../lib/geo-queries.ts'
import { useApi } from '../lib/mode.ts'
import { liveView, useDepartures } from '../lib/queries.ts'
import { stopHref } from '../lib/stops.ts'
import { useOnline } from '../lib/useNow.ts'

const MAX_M = 2000

function Row({ id, name, metres, nowMs }: { id: string; name: string; metres: number; nowMs: number }) {
  const { mode, fetcher } = useApi()
  const q = useDepartures(fetcher, mode, id, null)
  const online = useOnline()
  const { data, state } = liveView(id, q.data, nowMs, online, usePageCheck())
  // Soonest first by the time shown: dropping stale estimates keeps their order (Codex r1).
  const d = [...(data?.departures ?? [])]
    .sort((a, b) => (a.estDep ?? a.schedDep) - (b.estDep ?? b.schedDep))
    .find(
      (r) =>
        r.status !== 'cancelled' &&
        r.status !== 'skipped' &&
        minutesUntil(r.estDep ?? r.schedDep, nowMs) >= 0,
    )
  // LIVE only over the live departure it shows (R36-L1).
  useReportLive(
    `near:${id}`,
    state == null && q.data != null,
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
    data?.rtState === 'live' && d?.status === 'live',
  )
  return (
    <NearPlaceRow
      mode="bus"
      name={name}
      metres={metres}
      href={stopHref(id)}
      loading={q.isPending}
      next={
        d
          ? { route: d.route.short, to: d.headsign, minutes: minutesUntil(d.estDep ?? d.schedDep, nowMs) }
          : null
      }
      renderLink={({ href, className, children }) => (
        <Link to={href} className={className} prefetch="intent">
          {children}
        </Link>
      )}
    />
  )
}

export default function NearYou({ lat, lon, nowMs }: { lat: number; lon: number; nowMs: number }) {
  const { mode, fetcher } = useApi()
  const cells = useMemo(() => geohashNeighbourhood(geohashEncode(lat, lon, 5)), [lat, lon])
  const tiles = useGeoTiles(fetcher, mode, cells)
  const stops = nearest(
    lat,
    lon,
    tiles.tiles.flatMap((t) => t.stops),
    { limit: 3, maxMetres: MAX_M },
  )
  // A tile that failed to load is unknown, never "no stops": none found then is a failure, and some found may be
  // missing a nearer one.
  const retry = (
    <button
      type="button"
      onClick={tiles.retry}
      className="min-h-11 font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
    >
      Try again
    </button>
  )
  if (!stops.length)
    return (
      <p
        className="flex flex-wrap items-center gap-x-2 px-1 text-sm text-sched-text dark:text-night-text/70"
        role="status"
      >
        {tiles.loading ? (
          'Finding stops near you…'
        ) : tiles.error ? (
          <>
            Couldn't load stops near you.
            {retry}
          </>
        ) : (
          'No bus stops within 2 km.'
        )}
      </p>
    )
  return (
    <>
      {tiles.error ? (
        <p
          className="flex flex-wrap items-center gap-x-2 px-1 text-[13px] text-sched-text dark:text-night-text/70"
          role="status"
        >
          Couldn't load some stops nearby, so this list may be incomplete.
          {retry}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2" aria-label="Nearest stops">
        {stops.map((s) => (
          <Row key={s.key} id={s.key} name={s.name} metres={s.metres} nowMs={nowMs} />
        ))}
      </ul>
    </>
  )
}
