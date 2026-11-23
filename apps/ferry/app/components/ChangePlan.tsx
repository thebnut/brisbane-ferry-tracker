/**
 * The planner's answer when no ferry runs direct (the cross-river ferries, F22 to F24): "Change at <terminal>", the
 * soonest-arriving pair of ferries that connect (the second leaving two to 60 minutes after the first arrives, so an
 * overnight wait is never shown as a connection), the wait between them, a date on any ferry not today, and a link to
 * each leg's board. Its own chunk, loaded only for such a pair. It marks nothing LIVE and reports nothing to the
 * header: these are next-ferry times, and each leg's board has the live detail.
 */
import type { Departure } from '@bft/core/contract'
import { arrivalAfter, dayMarker, formatClock, isMissingStop } from '@bft/ui'
import { usePageCheck } from '@bft/ui/connectivity'
import { Link } from 'react-router'
import { boardState, effectiveDep, visibleRows } from '../lib/departures.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import { boardHref, type Terminal } from '../lib/terminals.ts'
import { useOnline } from '../lib/useNow.ts'

/** Time to walk between ferries at the change. */
const CHANGE_S = 120
/** The longest wait at the change still shown as a connection: past it (the last ferry, overnight), none is. */
const MAX_WAIT_S = 60 * 60
/** How many of the first leg's next ferries are tried: a later one can arrive first (an express, a delay). */
const FIRST_LEG_TRIES = 6

const boardable = (list: Departure[]) =>
  list
    .filter((d) => d.status !== 'cancelled' && d.status !== 'skipped')
    .sort((a, b) => effectiveDep(a) - effectiveDep(b))

const arrives = (d: Departure) => {
  const raw = d.estArrTo ?? d.schedArrTo
  return raw != null ? arrivalAfter(effectiveDep(d), raw) : null
}

/**
 * The trip with one change that gets there first: of the first leg's next few ferries, each with every second-leg ferry
 * leaving two to 60 minutes after it arrives, the pair arriving soonest (then the later first ferry, the shorter wait).
 * With no such pair, the first leg's next ferry alone (`b` null); with none, null.
 */
export function connection(first: Departure[], second: Departure[]) {
  const ones = boardable(first).slice(0, FIRST_LEG_TRIES)
  const twos = boardable(second)
  let best: { a: Departure; arr: number; b: Departure; wait: number; arrB: number | null } | null = null
  for (const a of ones) {
    const arr = arrives(a)
    if (arr == null) continue
    // Every second-leg ferry in the window, not just the first: a later express can arrive sooner (Codex release review).
    for (const b of twos) {
      const dep = effectiveDep(b)
      if (dep < arr + CHANGE_S) continue
      if (dep - arr > MAX_WAIT_S) break
      const arrB = arrives(b)
      const end = arrB ?? dep
      const bestEnd = best ? (best.arrB ?? effectiveDep(best.b)) : Number.POSITIVE_INFINITY
      // Same arrival: the later first ferry, the shorter wait at the change.
      const better =
        end < bestEnd || (best != null && end === bestEnd && effectiveDep(a) > effectiveDep(best.a))
      if (better) best = { a, arr, b, wait: dep - arr, arrB }
    }
  }
  if (best) return best
  const a = ones[0]
  return a ? { a, arr: arrives(a), b: null, wait: null, arrB: null } : null
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
  // A time with its date when it isn't today ("6:05 am (21/11)"): a trip shown at night may start tomorrow.
  const clock = (s: number) => {
    const day = dayMarker(s, nowMs)
    return day ? `${formatClock(s)} ${day}` : formatClock(s)
  }
  const line = (d: Departure | null | undefined, arr: number | null | undefined, at: Terminal) =>
    d
      ? `${clock(effectiveDep(d))} ${d.route.short} towards ${cleanStopName(d.headsign)}${arr != null ? ` · arrives ${n(at)} ${clock(arr)}` : ''}`
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
                {c?.b
                  ? `${Math.round((c.wait ?? 0) / 60)} min wait · ${line(c.b, c.arrB, to)}`
                  : c && !loading && !failed
                    ? 'No ferry on within an hour of arriving. Check this board for later ones.'
                    : line(null, null, to)}
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
