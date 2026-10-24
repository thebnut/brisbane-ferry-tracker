/**
 * Ferry home's Near you (THE-118 PR 8), once the device's position is known: the three nearest terminals (from the
 * bundled terminal list, so the position never leaves the browser), each with its next departure. Its own chunk,
 * loaded only then. Each row reports to the page header like a board.
 */
import { nearest } from '@bft/core/geo'
import { minutesUntil } from '@bft/ui'
import { awaitingSeedAnswer, usePageCheck } from '@bft/ui/connectivity'
import { NearPlaceRow, useReportLive } from '@bft/ui/mode-home'
import { Link } from 'react-router'
import { boardState, effectiveDep, visibleRows } from '../lib/departures.ts'
import { CARD_ROWS } from '../lib/home-card.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import { boardHref, TERMINALS } from '../lib/terminals.ts'
import { useOnline } from '../lib/useNow.ts'

const PLACES = TERMINALS.map((t) => ({ key: t.id, lat: t.lat, lon: t.lng, name: cleanStopName(t.name) }))

function Row({
  id,
  name,
  metres,
  nowMs,
  mode,
}: {
  id: string
  name: string
  metres: number
  nowMs: number
  mode: DataMode
}) {
  const q = useDepartures(useFetcher(mode), mode, id, '', null, null, true, CARD_ROWS)
  const online = useOnline()
  const state = boardState(q.data, !online, nowMs, usePageCheck())
  const rows = visibleRows(q.data?.departures ?? [], state, nowMs)
  const d = rows.find((r) => r.status !== 'cancelled' && r.status !== 'skipped')
  // "No more departures today" only from a live, fresh answer that says so (Codex release review r2). A failure holds
  // while it asks again (a query with no data goes back to pending, failureCount 0, R39-P2-2); an answer that isn't
  // live (stale, offline, unavailable) with nothing to show can't tell either; rows all gone since a live answer mean
  // it's old, so it waits for the next poll.
  const failed = q.isError || q.failureCount > 0 || q.errorUpdatedAt > q.dataUpdatedAt || state != null
  const old = !rows.length && !!q.data?.departures.length
  // The row marks no departure LIVE, so it never makes the header LIVE (R36-L1): live data claims nothing.
  useReportLive(
    `near:${id}`,
    state == null && q.data != null,
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
    false,
  )
  return (
    <NearPlaceRow
      mode="ferry"
      name={name}
      metres={metres}
      href={boardHref(id)}
      loading={q.isPending || old}
      failed={failed}
      onRetry={() => void q.refetch()}
      next={
        d
          ? {
              route: d.route.short,
              to: cleanStopName(d.headsign),
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
    <ul className="flex flex-col gap-2" aria-label="Nearest terminals">
      {nearest(lat, lon, PLACES, { limit: 3 }).map((p) => (
        <Row key={p.key} id={p.key} name={p.name} metres={p.metres} nowMs={nowMs} mode={mode} />
      ))}
    </ul>
  )
}
