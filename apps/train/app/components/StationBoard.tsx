/**
 * A station's departure board (T-Departures): platform-change banner, rtState/offline banners, departure rows, "More
 * departures". The board header with its filter row, star and "Going to" sheet is the page's (station.tsx, THE-118 PR
 * 5). Rendered on the server with the loader's rows, then polled every 15 s while visible.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import {
  DayDivider,
  dayDividers,
  EmptyState,
  ErrorState,
  formatClock,
  Icon,
  MoreButton,
  OfflineBanner,
  soonestIndex,
} from '@bft/ui'
import { leavingFrom } from '@bft/ui/board-header'
import { awaitingSeedAnswer, usePageCheck } from '@bft/ui/connectivity'
import { SaveToast, type SaveToastMessage } from '@bft/ui/save-toast'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { DEPARTURE_LIMIT } from '../lib/api.ts'
import {
  boardState,
  nextInstead,
  platformChanges,
  type ServiceFilter,
  trainCard,
  visibleRows,
} from '../lib/departures.ts'
import type { Station } from '../lib/network.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import {
  FAVOURITES_KEY,
  type Favourite,
  MAX_FAVOURITES,
  readFavourites,
  sameFavourite,
  toggleFavourite,
  writeFavourites,
} from '../lib/storage.ts'
import { useOnline } from '../lib/useNow.ts'
import { useReportLive } from './Chrome.tsx'
import { TrainCard } from './TrainCard.tsx'

export const MORE_LIMIT = 30

/**
 * The board's star (THE-118 PR 1): saves the station, with "Going to" when set (`to: null` is a valid favourite).
 * Saving shows the toast, which adds "Pick a destination" (the Going-to sheet) when there is none; a second tap unsaves.
 */
export function useStar(f: Favourite, name: string, pickDestination: () => void) {
  const [list, setList] = useState<Favourite[]>([])
  /**
   * `fav`: the favourite the toast is about, which Undo takes out even after the page has moved to another board (the
   * star lives on the station page, THE-118 PR 5). `evicted`: the one a full list let go to make room (MAX_FAVOURITES),
   * and its place, for Undo.
   */
  const [toast, setToast] = useState<
    (SaveToastMessage & { fav: Favourite; evicted: { fav: Favourite; at: number } | null }) | null
  >(null)
  // On another board, "Pick a destination" would pick for that board, not the saved one: only Undo stays.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the board.
  useEffect(
    () =>
      setToast((t) =>
        t?.pickDestination && !sameFavourite(t.fav, f) ? { ...t, pickDestination: undefined } : t,
      ),
    [f.from, f.to],
  )
  // The list as stored, again when another tab changes it.
  useEffect(() => {
    const read = () => setList(readFavourites())
    read()
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVOURITES_KEY || e.key == null) read()
    }
    addEventListener('storage', onStorage)
    return () => removeEventListener('storage', onStorage)
  }, [])
  const gone = useCallback(() => setToast(null), [])
  const saved = list.some((x) => sameFavourite(x, f))
  const toggle = () => {
    // Fresh from storage: another board or tab may have changed the list since this one read it.
    const before = readFavourites()
    // What the button showed decides: a "Save" tap never unsaves one saved elsewhere since.
    const adding = !saved
    const has = before.some((x) => sameFavourite(x, f))
    if (adding !== has) toggleFavourite(before, f)
    // What storage holds now: the star shows it, and a refused write (R27-S1) saved, removed and let go nothing.
    const after = readFavourites()
    setList(after)
    const kept = after.some((x) => sameFavourite(x, f)) === adding
    const at = before.findIndex((x) => !after.some((y) => sameFavourite(x, y)))
    const evicted = adding && at >= 0 ? { fav: before[at] as Favourite, at } : null
    setToast(
      !kept
        ? { name, fav: f, evicted: null, kept, remove: !adding }
        : adding
          ? { name, fav: f, evicted, pickDestination: f.to ? undefined : pickDestination }
          : null,
    )
  }
  const undo = () => {
    if (!toast) return
    const fav = toast.fav
    let now = readFavourites()
    if (now.some((x) => sameFavourite(x, fav)))
      now = writeFavourites(now.filter((x) => !sameFavourite(x, fav)))
    // The one a full list let go comes back at its place, unless it was saved again since, or the list is full again
    // (saved to elsewhere since): it never pushes another favourite out.
    const ev = toast.evicted
    if (ev && now.length < MAX_FAVOURITES && !now.some((x) => sameFavourite(x, ev.fav)))
      now = writeFavourites([...now.slice(0, ev.at), ev.fav, ...now.slice(ev.at)])
    setList(readFavourites())
    setToast(null)
  }
  return { saved, toggle, toast: <SaveToast toast={toast} onGone={gone} onUndo={undo} /> }
}

export function StationBoard({
  from,
  to,
  initial,
  nowMs,
  mode,
  filter,
  onData,
  at = null,
  returnBoard = false,
  alerts,
}: {
  from: Station
  to: Station | null
  initial: DeparturesResponse | null
  nowMs: number
  mode: DataMode
  filter: ServiceFilter
  /** Reports the latest response (for the status strip and the express filter). */
  onData?: (res: DeparturesResponse | undefined) => void
  /** "Depart from" (epoch s, the Now ▾ chip): trains from then; null is now, which `initial` is for. */
  at?: number | null
  /** The return board beside it on desktop: its own small title. */
  returnBoard?: boolean
  /** Beside the return board's title: its station's alert count (BrisbaneTransit, THE-118 PR 3). */
  alerts?: ReactNode
}) {
  const fetcher = useFetcher(mode)
  const online = useOnline()
  const [more, setMore] = useState(false)
  const limit = more ? MORE_LIMIT : DEPARTURE_LIMIT
  const q = useDepartures(
    fetcher,
    mode,
    from.key,
    to?.key ?? null,
    limit === DEPARTURE_LIMIT && at == null ? initial : null,
    limit,
    at,
  )
  const res = q.data ?? (more && at == null ? initial : undefined) ?? undefined
  useEffect(() => onData?.(res), [onData, res])
  // useOnline is false while offline, and also when the API calls fail or the service worker answers from its cache.
  const offline = !online || (res as { offline?: boolean } | undefined)?.offline === true
  // Data generated over a minute ago (e.g. a page reloaded from the service worker's cache) is not live either.
  // Data that came with a cached page isn't live until this board's own fresh answer arrives (R2-T7).
  const page = usePageCheck()
  const state = boardState(res, offline, nowMs, page)
  // A non-live seed whose own refetch is still out: pending ("Connecting…", no banner), never OFFLINE (R32-RT1).
  const waiting = res === q.data && awaitingSeedAnswer(q, state)
  // No data is never live (a first request that failed with an HTTP error leaves liveState null).
  useReportLive(
    `board:${from.key}>${to?.key ?? ''}`,
    state == null && res != null,
    (!res && !q.isError) || waiting,
  )

  const cards = useMemo(() => {
    // Not live: timetable only, no live estimates or platform changes, and nothing that has already left.
    // A later time's board: rows from then on, again once the live estimates are dropped (Codex r3).
    const rows = leavingFrom(visibleRows(res?.departures ?? [], state, nowMs), at)
    const list = rows.map((d, i) =>
      trainCard(
        d,
        nowMs,
        from.key,
        to?.key ?? null,
        d.status === 'cancelled' ? nextInstead(rows, i, from.key, to?.key ?? null) : undefined,
      ),
    )
    return filter === 'express' ? list.filter((c) => c.express) : list
  }, [res, nowMs, from.key, to?.key, filter, state, at])
  // Offline with nothing to show before this board's first answer since the page loaded (an offline reload starts
  // with the cached page's data, maybe last night's): its copies on hand are still being read, so it is loading, not
  // "no saved timetable" (R6-B1).
  const checking = state === 'offline' && cards.length === 0 && !q.isFetchedAfterMount
  const changes = res && state == null ? platformChanges(res.departures) : []
  // The soonest train you can board gets the orange border (every board's rule); later days get a divider.
  const soonest = soonestIndex(cards.map((c) => c.status))
  const dividers = dayDividers(
    cards.map((c) => c.dep),
    nowMs,
  )
  const title = `${from.name}${to ? ` → ${to.name}` : ''}`

  return (
    <section
      aria-label={`Departures ${title}`}
      className="flex min-w-0 flex-col gap-2.5"
      data-board={from.key}
    >
      {returnBoard ? (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
          <h2 className="text-base font-bold text-aqua-text dark:text-ferry-aqua-light">{title}</h2>
          {alerts}
        </div>
      ) : null}

      {changes.map((d) => (
        <div
          key={`pc:${d.tripInstance}`}
          role="status"
          data-testid="platform-change-banner"
          className="flex items-center gap-2.5 rounded-card border border-[#FDBA74] bg-[#FFF4E5] px-3 py-2.5 text-[13px] dark:border-ferry-orange/40 dark:bg-night-card"
        >
          <Icon name="alert" size={20} className="shrink-0 text-ferry-orange-aa" />
          <span>
            <strong>Platform change:</strong> the {formatClock(d.estDep ?? d.schedDep)} to{' '}
            {d.headsign.replace(/ station$/, '')} now leaves from platform {d.platform}, not{' '}
            {d.scheduledPlatform}.
          </span>
        </div>
      ))}

      {state && !waiting ? (
        <OfflineBanner
          kind={state}
          detail={
            state === 'offline'
              ? res
                ? "Timetabled trains from today's saved timetable. Delays, cancellations and platform changes can't be shown until you're back online."
                : 'No saved timetable for this trip yet. Save it to keep today’s times offline.'
              : undefined
          }
        />
      ) : null}

      {q.isError && !res ? (
        <ErrorState onRetry={() => q.refetch()}>
          The live feed didn't respond. Trying again shortly.
        </ErrorState>
      ) : null}

      {/* Offline, an empty board (express filter or not) only means the copies on hand ran out (Codex review). */}
      {res && cards.length === 0 && state === 'offline' && !checking ? (
        <EmptyState title="Offline: no saved timetable for these times">
          Trains may still be running. Times come back when you reconnect.
        </EmptyState>
      ) : res && cards.length === 0 && !checking ? (
        <EmptyState title={filter === 'express' ? 'No express trains soon' : 'No more trains today'}>
          {to
            ? `No direct trains from ${from.name} to ${to.name} in the next few hours.`
            : 'Check the timetable for tomorrow.'}
        </EmptyState>
      ) : null}

      {(!res && !q.isError) || checking ? (
        <div role="status" data-loading="" className="flex flex-col gap-2.5" aria-label="Loading trains">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-card bg-white/70 dark:bg-night-card" />
          ))}
        </div>
      ) : null}

      <ol className="flex flex-col gap-2.5" aria-label={`Next trains from ${title}`}>
        {cards.map((c, i) => (
          <li key={c.key}>
            {dividers[i] ? <DayDivider>{dividers[i]}</DayDivider> : null}
            <TrainCard card={c} from={from.key} to={to?.key ?? null} highlighted={i === soonest} />
          </li>
        ))}
      </ol>

      {res &&
      cards.length > 0 &&
      !more &&
      (res.departures.length >= DEPARTURE_LIMIT || filter === 'express') ? (
        <MoreButton onClick={() => setMore(true)}>More departures</MoreButton>
      ) : null}
    </section>
  )
}
