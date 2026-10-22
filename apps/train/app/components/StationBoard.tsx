/**
 * A station's departure board (T-Departures): board header "From → To" with the reachable-only "to" picker and swap,
 * platform-change banner, rtState/offline banners, departure cards, "More departures". Rendered on the server with
 * the loader's rows, then polled every 15 s while visible.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import {
  BoardHeader,
  BottomSheet,
  EmptyState,
  ErrorState,
  formatClock,
  Icon,
  MoreButton,
  OfflineBanner,
  SecondaryButton,
} from '@bft/ui'
import { usePageCheck } from '@bft/ui/connectivity'
import { SaveToast, type SaveToastMessage } from '@bft/ui/save-toast'
import { StarButton } from '@bft/ui/star'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { DEPARTURE_LIMIT } from '../lib/api.ts'
import { boardState, platformChanges, type ServiceFilter, trainCard, visibleRows } from '../lib/departures.ts'
import { isReachable, type Station, stationHref } from '../lib/network.ts'
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
import { ReachableList } from './ReachableList.tsx'
import { TrainCard } from './TrainCard.tsx'

export const MORE_LIMIT = 30

/**
 * The board's star (THE-118 PR 1): saves the station, with "Going to" when set (`to: null` is a valid favourite).
 * Saving shows the toast, which adds "Pick a destination" (the Going-to sheet) when there is none; a second tap unsaves.
 */
export function useStar(f: Favourite, name: string, pickDestination: () => void) {
  const [list, setList] = useState<Favourite[]>([])
  /** `evicted`: the favourite a full list let go to make room (MAX_FAVOURITES), and its place, for Undo. */
  const [toast, setToast] = useState<
    (SaveToastMessage & { evicted: { fav: Favourite; at: number } | null }) | null
  >(null)
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
        ? { name, evicted: null, kept, remove: !adding }
        : adding
          ? { name, evicted, pickDestination: f.to ? undefined : pickDestination }
          : null,
    )
  }
  const undo = () => {
    let now = readFavourites()
    if (now.some((x) => sameFavourite(x, f))) now = writeFavourites(now.filter((x) => !sameFavourite(x, f)))
    // The one a full list let go comes back at its place, unless it was saved again since, or the list is full again
    // (saved to elsewhere since): it never pushes another favourite out.
    const ev = toast?.evicted
    if (ev && now.length < MAX_FAVOURITES && !now.some((x) => sameFavourite(x, ev.fav)))
      now = writeFavourites([...now.slice(0, ev.at), ev.fav, ...now.slice(ev.at)])
    setList(readFavourites())
    setToast(null)
  }
  return { saved, toggle, toast: <SaveToast toast={toast} onGone={gone} onUndo={undo} /> }
}

export const boardHref = (from: string, to: string | null) => `${stationHref(from)}${to ? `?to=${to}` : ''}`

export function StationBoard({
  from,
  to,
  initial,
  nowMs,
  mode,
  filter,
  onData,
  compactHeader = false,
}: {
  from: Station
  to: Station | null
  initial: DeparturesResponse | null
  nowMs: number
  mode: DataMode
  filter: ServiceFilter
  /** Reports the latest response (for the status strip and the express filter). */
  onData?: (res: DeparturesResponse | undefined) => void
  /** Second board on desktop: no picker, just the title and swap. */
  compactHeader?: boolean
}) {
  const navigate = useNavigate()
  const fetcher = useFetcher(mode)
  const online = useOnline()
  const [more, setMore] = useState(false)
  const [picker, setPicker] = useState(false)
  const limit = more ? MORE_LIMIT : DEPARTURE_LIMIT
  const q = useDepartures(
    fetcher,
    mode,
    from.key,
    to?.key ?? null,
    limit === DEPARTURE_LIMIT ? initial : null,
    limit,
  )
  const res = q.data ?? (more ? initial : undefined) ?? undefined
  useEffect(() => onData?.(res), [onData, res])
  // useOnline is false while offline, and also when the API calls fail or the service worker answers from its cache.
  const offline = !online || (res as { offline?: boolean } | undefined)?.offline === true
  // Data generated over a minute ago (e.g. a page reloaded from the service worker's cache) is not live either.
  // Data that came with a cached page isn't live until this board's own fresh answer arrives (R2-T7).
  const page = usePageCheck()
  const state = boardState(res, offline, nowMs, page)
  useReportLive(`board:${from.key}>${to?.key ?? ''}`, state == null)

  const cards = useMemo(() => {
    // Not live: timetable only, no live estimates or platform changes, and nothing that has already left.
    const rows = visibleRows(res?.departures ?? [], state, nowMs)
    const list = rows.map((d) => trainCard(d, nowMs, from.key, to?.key ?? null))
    return filter === 'express' ? list.filter((c) => c.express) : list
  }, [res, nowMs, from.key, to?.key, filter, state])
  // Offline with nothing to show before this board's first answer since the page loaded (an offline reload starts
  // with the cached page's data, maybe last night's): its copies on hand are still being read, so it is loading, not
  // "no saved timetable" (R6-B1).
  const checking = state === 'offline' && cards.length === 0 && !q.isFetchedAfterMount
  const changes = res && state == null ? platformChanges(res.departures) : []
  const firstLive = cards.findIndex((c) => !c.cancelled)
  const canSwap = !!to && isReachable(to.key, from.key)
  const title = `${from.name}${to ? ` → ${to.name}` : ''}`
  const star = useStar({ from: from.key, to: to?.key ?? null }, title, () => setPicker(true))

  return (
    <section
      aria-label={`Departures ${title}`}
      className="flex min-w-0 flex-col gap-2.5"
      data-board={from.key}
    >
      <BoardHeader
        as="h2"
        onSwap={canSwap && to ? () => navigate(boardHref(to.key, from.key)) : undefined}
        trailing={
          compactHeader ? undefined : <StarButton saved={star.saved} onToggle={star.toggle} name={title} />
        }
      >
        {compactHeader ? (
          <span className="truncate text-base font-bold">{title}</span>
        ) : (
          <button
            type="button"
            onClick={() => setPicker(true)}
            aria-label={`${title}. Choose where you're going`}
            className="flex min-w-0 items-center gap-1 text-left text-base font-bold"
          >
            <span className="truncate">{title}</span>
            {to ? null : (
              <span className="shrink-0 text-sm font-semibold text-ferry-orange-deep">· Going to…</span>
            )}
            <Icon name="chevronDown" size={18} className="shrink-0 text-ferry-orange" />
          </button>
        )}
      </BoardHeader>

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

      {state ? (
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
            <TrainCard
              card={c}
              from={from.key}
              to={to?.key ?? null}
              highlighted={i === firstLive && c.express}
            />
          </li>
        ))}
      </ol>

      {res &&
      cards.length > 0 &&
      !more &&
      (res.departures.length >= DEPARTURE_LIMIT || filter === 'express') ? (
        <MoreButton onClick={() => setMore(true)}>More departures</MoreButton>
      ) : null}

      {compactHeader ? null : star.toast}
      {compactHeader ? null : (
        <BottomSheet
          open={picker}
          onClose={() => setPicker(false)}
          title={`Going to, from ${from.name}`}
          subtitle={
            <span className="text-xs text-sched-text">Only stations with a direct train are shown.</span>
          }
        >
          <div className="flex flex-col gap-3 px-4 py-4">
            {to ? (
              <SecondaryButton
                className="min-h-10 self-start px-4 text-sm"
                onClick={() => {
                  setPicker(false)
                  navigate(boardHref(from.key, null))
                }}
              >
                Any destination
              </SecondaryButton>
            ) : null}
            <ReachableList
              from={from}
              selected={to?.key ?? null}
              onPick={(k) => {
                setPicker(false)
                navigate(boardHref(from.key, k))
              }}
            />
          </div>
        </BottomSheet>
      )}
    </section>
  )
}
