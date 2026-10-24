/**
 * Train home's Near you (THE-118 PR 8), once the device's position is known: the three nearest stations (from the
 * bundled network, so the position never leaves the browser), each with its next train. Its own chunk, loaded only
 * then. Each row reports to the page header like a board.
 */
import { nearest } from '@bft/core/geo'
import { minutesUntil } from '@bft/ui'
import { awaitingSeedAnswer, usePageCheck } from '@bft/ui/connectivity'
import { NearPlaceRow } from '@bft/ui/mode-home'
import { Link } from 'react-router'
import { boardState, effectiveDep, visibleRows } from '../lib/departures.ts'
import { STATIONS, stationHref } from '../lib/network.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import { useOnline } from '../lib/useNow.ts'
import { useReportLive } from './Chrome.tsx'

function Row({
  station,
  name,
  metres,
  nowMs,
  mode,
}: {
  station: string
  name: string
  metres: number
  nowMs: number
  mode: DataMode
}) {
  const q = useDepartures(useFetcher(mode), mode, station, null, null, 4)
  const online = useOnline()
  const state = boardState(
    q.data,
    !online || (q.data as { offline?: boolean } | undefined)?.offline === true,
    nowMs,
    usePageCheck(),
  )
  const rows = visibleRows(q.data?.departures ?? [], state, nowMs)
  const d = rows.find((r) => r.status !== 'cancelled' && r.status !== 'skipped')
  // "No more departures today" only from an answer that says so (Codex release review r2). A failure holds while it
  // asks again (a query with no data goes back to pending, failureCount 0, R39-P2-2), as does an offline copy with
  // nothing to come; rows all gone since the answer mean it's old, so it waits for the next poll.
  const failed = q.isError || q.failureCount > 0 || q.errorUpdatedAt > q.dataUpdatedAt || state === 'offline'
  const old = !rows.length && !!q.data?.departures.length
  // LIVE only over the live train it shows (R36-L1).
  useReportLive(
    `near:${station}`,
    state == null && q.data != null,
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
    q.data?.rtState === 'live' && d?.status === 'live',
  )
  return (
    <NearPlaceRow
      mode="train"
      name={name}
      metres={metres}
      href={stationHref(station)}
      loading={q.isPending || old}
      failed={failed}
      onRetry={() => void q.refetch()}
      next={
        d
          ? {
              route: d.route.short,
              to: d.headsign.replace(/ station$/, ''),
              minutes: minutesUntil(effectiveDep(d), nowMs),
            }
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

export default function NearYou({
  lat,
  lon,
  nowMs,
  mode,
}: {
  lat: number
  lon: number
  nowMs: number
  mode: DataMode
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Nearest stations">
      {nearest(lat, lon, STATIONS, { limit: 3 }).map((s) => (
        <Row key={s.key} station={s.key} name={s.name} metres={s.metres} nowMs={nowMs} mode={mode} />
      ))}
    </ul>
  )
}
