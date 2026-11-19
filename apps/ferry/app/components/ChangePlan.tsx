/**
 * The planner's answer when no ferry runs direct (the cross-river ferries, F22 to F24): "Change at <terminal>", each
 * leg's next ferry that connects (the second leg leaving at least two minutes after the first arrives), and a link to
 * each leg's board. Its own chunk, loaded only for such a pair. It marks nothing LIVE and reports nothing to the
 * header: these are next-ferry times, and each leg's board has the live detail.
 */
import type { Departure } from '@bft/core/contract'
import { arrivalAfter, formatClock, isMissingStop } from '@bft/ui'
import { usePageCheck } from '@bft/ui/connectivity'
import { Link } from 'react-router'
import { boardState, effectiveDep, visibleRows } from '../lib/departures.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import { boardHref, type Terminal } from '../lib/terminals.ts'
import { useOnline } from '../lib/useNow.ts'

/** Time to walk between ferries at the change. */
const CHANGE_S = 120

const boardable = (list: Departure[]) =>
  list
    .filter((d) => d.status !== 'cancelled' && d.status !== 'skipped')
    .sort((a, b) => effectiveDep(a) - effectiveDep(b))

/** The first leg's next ferry and the second leg's first one after it arrives (with time to change). */
export function connection(first: Departure[], second: Departure[]) {
  const a = boardable(first)[0]
  if (!a) return null
  const dep = effectiveDep(a)
  const raw = a.estArrTo ?? a.schedArrTo
  const arr = raw != null ? arrivalAfter(dep, raw) : null
  const b = arr != null ? boardable(second).find((d) => effectiveDep(d) >= arr + CHANGE_S) : undefined
  if (!b) return { a, arr, b: null, arrB: null }
  const rawB = b.estArrTo ?? b.schedArrTo
  return { a, arr, b, arrB: rawB != null ? arrivalAfter(effectiveDep(b), rawB) : null }
}

function useLeg(fromId: string, toId: string, nowMs: number, mode: DataMode) {
  const q = useDepartures(useFetcher(mode), mode, fromId, toId, null, null, true, 20)
  const online = useOnline()
  const state = boardState(q.data, !online, nowMs, usePageCheck())
  return { q, rows: visibleRows(q.data?.departures ?? [], state, nowMs) }
}

const LEG =
  'flex min-h-12 items-center justify-between gap-3 rounded-card bg-white px-3 py-2 text-inherit no-underline shadow-card dark:bg-night-2'

export default function ChangePlan({
  from,
  via,
  to,
  nowMs,
  mode,
}: {
  from: Terminal
  via: Terminal
  to: Terminal
  nowMs: number
  mode: DataMode
}) {
  const one = useLeg(from.id, via.id, nowMs, mode)
  const two = useLeg(via.id, to.id, nowMs, mode)
  const c = connection(one.rows, two.rows)
  const loading = one.q.isPending || two.q.isPending
  const missing = isMissingStop(one.q.error) || isMissingStop(two.q.error)
  const failed = (one.q.isError && !one.q.data) || (two.q.isError && !two.q.data)
  const none = loading
    ? 'Getting times…'
    : failed
      ? 'Times unavailable right now'
      : 'No connecting ferry found today'
  const n = (t: Terminal) => cleanStopName(t.name)
  const line = (d: Departure | null | undefined, arr: number | null | undefined, at: Terminal) =>
    d
      ? `${formatClock(effectiveDep(d))} ${d.route.short} towards ${cleanStopName(d.headsign)}${arr != null ? ` · arrives ${n(at)} ${formatClock(arr)}` : ''}`
      : none
  return (
    <div data-plan="change" className="flex flex-col gap-2">
      <p className="text-sm font-semibold">
        No direct ferry. Change at <strong>{n(via)}</strong>.
      </p>
      {missing ? (
        <p className="text-sm text-gray-700 dark:text-night-text/80">
          One of these terminals has no services in the current timetable. It may be closed for works.
        </p>
      ) : null}
      <ol className="flex flex-col gap-2" aria-label={`${n(from)} to ${n(to)}, changing at ${n(via)}`}>
        <li>
          <Link to={boardHref(from.id, via.id)} className={LEG} prefetch="intent" data-leg="1">
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-bold">
                1. {n(from)} → {n(via)}
              </span>
              <span className="text-[13px] text-sched-text dark:text-night-text/80">
                {line(c?.a, c?.arr, via)}
              </span>
            </span>
            <span className="shrink-0 text-sm font-bold text-aqua-text dark:text-ferry-aqua-light">
              Board ›
            </span>
          </Link>
        </li>
        <li>
          <Link to={boardHref(via.id, to.id)} className={LEG} prefetch="intent" data-leg="2">
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-bold">
                2. {n(via)} → {n(to)}
              </span>
              <span className="text-[13px] text-sched-text dark:text-night-text/80">
                {line(c?.b, c?.arrB, to)}
              </span>
            </span>
            <span className="shrink-0 text-sm font-bold text-aqua-text dark:text-ferry-aqua-light">
              Board ›
            </span>
          </Link>
        </li>
      </ol>
    </div>
  )
}
