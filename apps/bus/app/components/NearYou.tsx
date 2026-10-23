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
  useReportLive(
    `near:${id}`,
    state == null && q.data != null,
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
  )
  const d = data?.departures.find(
    (r) =>
      r.status !== 'cancelled' && r.status !== 'skipped' && minutesUntil(r.estDep ?? r.schedDep, nowMs) >= 0,
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
  if (!stops.length)
    return (
      <p className="px-1 text-sm text-sched-text dark:text-night-text/70" role="status">
        {tiles.loading ? 'Finding stops near you…' : 'No bus stops within 2 km.'}
      </p>
    )
  return (
    <ul className="flex flex-col gap-2" aria-label="Nearest stops">
      {stops.map((s) => (
        <Row key={s.key} id={s.key} name={s.name} metres={s.metres} nowMs={nowMs} />
      ))}
    </ul>
  )
}
