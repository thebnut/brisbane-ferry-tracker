/**
 * A ferry terminal's board (THE-118 PR 5): the board header (kicker, terminal, routes, alert count, star) with one
 * filter row (All, To… ▾, ⇄, Express, Map, Now ▾), the status line, rtState/offline banners and the departures
 * (each row opens its trip page, THE-118 PR 6), with the live map and stop selector. With a "To", desktop shows the return board beside it (until the
 * return-board rule of THE-118 PR 7). Rendered on the server with the loader's rows, then polled every 15 s while
 * visible.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import { BottomSheet, DemoExitLink, formatAge, formatClock, OfflineBanner, useFixtureCookie } from '@bft/ui'
import { BoardHeader, Chip, FilterRow, leavingFrom, NowChip } from '@bft/ui/board-header'
import { sourceTimeS, usePageCheck } from '@bft/ui/connectivity'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  applyFilter,
  bannerState,
  boardState,
  hasExpress,
  type ServiceFilter,
  visibleRows,
} from '../lib/departures.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useDepartures, useFetcher, useShownData } from '../lib/queries.ts'
import { FIXTURE_COOKIE, readDepartAt, readSavedPair, writeDepartAt } from '../lib/storage.ts'
import {
  boardHref,
  normalisePair,
  type StopChoice,
  type StopPair,
  terminalById,
  tripHref,
} from '../lib/terminals.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type BoardAlerts from './BoardAlerts.tsx'
import { DepartureList } from './DepartureList.tsx'
import type FerryStar from './FerryStar.tsx'
import { SiteHeader, UpdatedStrip } from './header.tsx'

// If the map sheet's chunk can't load, the board stays up (the Map button just does nothing).
const NoMap = (() => null) as never // renders nothing, whatever the props
const LiveMapSheet = lazy(() => import('./LiveMapSheet.tsx').catch(() => ({ default: NoMap })))
const StopSelector = lazy(() => import('./StopSelector.tsx'))
// The "To…" chip's sheet (Train's "Going to" sheet), off the first load. If its chunk can't load (offline before the
// service worker cached it), a short sheet says so and the board stays; the next tap tries again.
// It stays mounted once opened, so closing it gives focus back to the chip (Codex r4).
let toLoad = 0
let toFailed = false
const loadToSheet = () => {
  toLoad++
  toFailed = false
  return lazy(() =>
    import('./ToSheet.tsx').catch(() => {
      toFailed = true
      return { default: ToUnavailable }
    }),
  )
}
let ToSheet = loadToSheet()

function ToUnavailable({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Choose where you're going">
      <p className="px-5 pb-5 text-sm">
        Destinations can't load without a connection. Try again once you're back online.
      </p>
    </BottomSheet>
  )
}
export interface FerryBoardsProps {
  /** The terminal the board is for. */
  from: StopChoice
  /** Its "To": only ferries going there, with arrival times. Null: every departure. */
  to: StopChoice | null
  /** The server's rows: from → to (every departure without a "To"). */
  outbound: DeparturesResponse | null
  /** to → from, the desktop return board; null without a "To". */
  inbound: DeparturesResponse | null
  /** Server render time, epoch ms (hydration-stable clock). */
  renderedAt: number
  mode: DataMode
  /**
   * Ferry home (/ferry): the board of the trip this device saved (the server's from the cookie). After hydration it
   * follows the saved pair or the first favourite, and the stop selector changes it here; a terminal page navigates.
   */
  home?: boolean
  children?: ReactNode
}

function SheetFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="status">
      <span className="rounded-card bg-white px-6 py-4 text-sm shadow-lg">Loading…</span>
    </div>
  )
}

/** The board header's routes: "3 routes". */
const routesText = (id: string) => {
  const n = terminalById(id)?.routes.length ?? 0
  return n ? `${n} route${n === 1 ? '' : 's'}` : null
}

export function FerryBoards({
  from: serverFrom,
  to: serverTo,
  outbound,
  inbound,
  renderedAt,
  mode,
  home = false,
  children,
}: FerryBoardsProps) {
  const [trip, setTrip] = useState({ from: serverFrom, to: serverTo })
  const [filter, setFilter] = useState<ServiceFilter>('all')
  const [departAt, setDepartAt] = useState<number | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [showSelector, setShowSelector] = useState(false)
  // Null until first opened (then the sheet stays mounted: closing it gives focus back to the chip).
  const [showTo, setShowTo] = useState<boolean | null>(null)
  const [Star, setStar] = useState<typeof FerryStar | null>(null)
  const [Alerts, setAlerts] = useState<typeof BoardAlerts | null>(null)
  const navigate = useNavigate()
  const openTo = () => {
    // The last try couldn't load the sheet: try again.
    if (toFailed) ToSheet = loadToSheet()
    setShowTo(true)
  }
  const now = useNow(renderedAt, 5_000)
  const online = useOnline()
  const fetcher = useFetcher(mode)

  // After hydration: saved pair (home only), session "Depart from", fixture cookie. A first visit gets the onboarding
  // prompt (P4, its own lazy slot), which replaced the stop selector opening by itself here. The star (THE-118) loads
  // then, with the favourites' code: with no saved pair, the home board opens the first favourite.
  useEffect(() => {
    const show = (p: StopPair | null) => {
      if (p && (p.outbound.id !== serverFrom.id || p.inbound.id !== serverTo?.id))
        setTrip({ from: p.outbound, to: p.inbound })
    }
    const saved = home ? readSavedPair() : null
    show(saved)
    setDepartAt(readDepartAt())
    // A trip page's "Track on map" (THE-118 PR 6): the board with its map open.
    if (new URLSearchParams(location.search).has('map')) setShowMap(true)
    let live = true
    import('./FerryStar.tsx').then(
      (m) => {
        // Gone before the chunk arrived (a quick navigation, or a test's teardown): nothing to update.
        if (!live) return
        setStar(() => m.default)
        if (home && !saved) {
          show(m.firstFavouritePair())
          // The cookie again, so the next load renders that pair (a session-only pair's cookie ends with the session).
          m.writePairCookie()
        }
      },
      () => {}, // Offline before the chunk was cached: no star until the next load.
    )
    // The alert count in the board header: BrisbaneTransit's (THE-118 PR 3; nothing in this app), off the first load.
    import('./BoardAlerts.tsx').then(
      (m) => live && setAlerts(() => m.default),
      () => {},
    )
    return () => {
      live = false
    }
  }, [home, serverFrom, serverTo])
  // Demo mode lasts an hour from ?fixtures=1 and ends with ?fixtures=0. Never from the data mode alone: an API
  // failure that fell back to fixtures (FIXTURE_FALLBACK) used to make demo mode stick for the session (R7-B1).
  useFixtureCookie(FIXTURE_COOKIE, mode.fixtures, mode.forced === true, mode.allowed === true)

  const fromId = trip.from.id
  const toId = trip.to?.id ?? ''
  const useInitial = fromId === serverFrom.id && toId === (serverTo?.id ?? '') && departAt == null
  const out = useDepartures(fetcher, mode, fromId, toId, departAt, useInitial ? outbound : null)
  // The return board (desktop), only with a "To".
  const back = useDepartures(fetcher, mode, toId, fromId, departAt, useInitial ? inbound : null, !!trip.to)
  const boards = trip.to ? [out, back] : [out]

  const offline = !online
  // Data that came with a cached page isn't live until its board's own fresh answer arrives (R2-T7).
  const page = usePageCheck()
  const stateOf = (q: typeof out) => boardState(q.data, offline, now, page)
  // Offline, a board shows the best copy on hand: its data, or the copy kept on this device. After an offline reload
  // its data is the cached page's (maybe last night's, every row gone) until the first poll (R6-B1). Read only once
  // the board is offline, after hydration, so the first render still matches the HTML, and once per change, not per
  // tick (L8); which copy is best still depends on the time.
  const holds = (q: typeof out) => departAt == null && stateOf(q) === 'offline'
  const outData = useShownData(out.data, fromId, toId, holds(out), now)
  const backShown = useShownData(back.data, toId, fromId, holds(back), now)
  const backData = trip.to ? backShown : undefined
  const view = (q: typeof out, data: typeof outData) =>
    // A later time's board: rows from then on, again once the live estimates are dropped (Codex r3).
    data ? applyFilter(leavingFrom(visibleRows(data.departures, stateOf(q), now), departAt), filter) : null
  const outList = view(out, outData)
  const backList = view(back, backData)
  const express = hasExpress(outData?.departures, backData?.departures)
  const latest = outData ?? backData
  const outState = stateOf(out)
  const backState = stateOf(back)
  const state = bannerState(
    out.data ? [outState, trip.to && back.data ? backState : null] : [trip.to ? backState : null],
  )
  // Every board with data is live (after a cached page each board confirms itself with its own data, R2-T7): the
  // header's LIVE and the map, which shows both directions.
  const boardsLive = boards.every((q) => !q.data || stateOf(q) == null)
  const live = latest?.rtState === 'live' && boardsLive
  // The time of the data shown (a service-worker copy keeps its own time), not when it was fetched.
  const updatedAt = Math.max(outData?.generatedAt ?? 0, backData?.generatedAt ?? 0)
  const fetching = boards.some((q) => q.isFetching)
  // No answer yet for any board (no data, no error): the transit header says "Connecting…", not OFFLINE.
  const pending = !outData && !backData && boards.every((q) => !q.isError)

  const refresh = () => {
    for (const q of boards) void q.refetch()
  }

  // The board for another trip: a terminal page's URL (`?to=`), so back works and the link can be shared.
  const open = (next: string, nextTo: string | null) => {
    setShowTo(false)
    navigate(boardHref(next, nextTo))
  }

  // The selector has saved the pair (savePair): home shows it here; a terminal page opens its board.
  const save = (next: StopPair) => {
    setShowSelector(false)
    setDepartAt(null)
    writeDepartAt(null)
    if (!home) return open(next.outbound.id, next.inbound.id)
    setTrip({ from: next.outbound, to: next.inbound })
  }

  const fromName = cleanStopName(trip.from.name)
  const toName = trip.to ? cleanStopName(trip.to.name) : ''
  return (
    <>
      <SiteHeader onSettings={() => setShowSelector(true)} live={live} pending={pending} />

      <main className="mx-auto max-w-6xl px-3 py-4 md:px-4 md:py-6">
        <div className={trip.to ? 'flex flex-col gap-3' : 'mx-auto flex max-w-2xl flex-col gap-3'}>
          <BoardHeader
            kicker="Ferry terminal"
            as="h2"
            name={fromName}
            facts={[
              routesText(fromId),
              Alerts ? <Alerts key="alerts" fetcher={fetcher} mode={mode} /> : null,
            ]}
            star={
              Star ? (
                <Star from={fromId} to={trip.to?.id ?? null} onPickDestination={openTo} />
              ) : (
                <span aria-hidden="true" className="block h-11 w-24 shrink-0" />
              )
            }
          >
            <FilterRow label="Filter ferries">
              <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </Chip>
              <Chip opens on={!!trip.to} onClick={openTo}>
                {trip.to ? `To ${toName}` : 'To…'}
              </Chip>
              {trip.to ? (
                <Chip icon="swap" label="Swap direction" onClick={() => open(toId, fromId)} />
              ) : null}
              {express || filter === 'express' ? (
                <Chip pressed={filter === 'express'} onClick={() => setFilter('express')}>
                  Express
                </Chip>
              ) : null}
              <Chip icon="map" pressed={showMap} onClick={() => setShowMap((v) => !v)}>
                Map
              </Chip>
              <NowChip
                value={departAt}
                onChange={(v) => {
                  setDepartAt(v)
                  writeDepartAt(v)
                }}
                nowMs={now}
              />
            </FilterRow>
          </BoardHeader>
          <UpdatedStrip
            board
            updated={`Last updated ${formatClock(Math.floor((updatedAt || renderedAt) / 1000))}`}
            detail={formatAge(sourceTimeS(latest, { nowMs: now, ...page }), now)}
            onRefresh={refresh}
            refreshing={fetching}
            live={live}
            pending={pending}
          />

          {state ? <OfflineBanner kind={state} /> : null}

          {mode.fixtures ? (
            <p
              role="note"
              data-banner="demo"
              className="rounded-card border border-aqua-text/30 bg-ferry-light-blue px-3.5 py-2.5 text-sm text-charcoal"
            >
              <strong className="font-bold">Demo data.</strong> A recorded weekday timetable with simulated
              live times, not today's real departures. <DemoExitLink />
            </p>
          ) : null}

          <div className={trip.to ? 'grid gap-6 md:grid-cols-2 md:gap-8' : undefined}>
            <DepartureList
              id="outbound"
              label={trip.to ? `${fromName} to ${toName}` : `Departures from ${fromName}`}
              departures={outList}
              nowMs={now}
              loading={out.isPending}
              error={out.isError}
              onRetry={() => void out.refetch()}
              offline={outState === 'offline'}
              tripHref={(d) => tripHref(d.tripInstance, fromId, trip.to?.id)}
            />
            {trip.to ? (
              <div className="hidden md:block">
                <DepartureList
                  id="inbound"
                  label={`${toName} to ${fromName}`}
                  title={`${toName} → ${fromName}`}
                  departures={backList}
                  nowMs={now}
                  loading={back.isPending}
                  error={back.isError}
                  onRetry={() => void back.refetch()}
                  offline={backState === 'offline'}
                  tripHref={(d) => tripHref(d.tripInstance, toId, fromId)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {children}

      {showMap ? (
        <Suspense fallback={<SheetFallback />}>
          <LiveMapSheet
            from={trip.from}
            to={trip.to}
            live={boardsLive}
            departures={boards.flatMap((q) => q.data?.departures ?? [])}
            fetcher={fetcher}
            mode={mode}
            onClose={() => setShowMap(false)}
            onSelect={(d) =>
              navigate(
                d.stopId === fromId
                  ? tripHref(d.tripInstance, fromId, trip.to?.id)
                  : tripHref(d.tripInstance, toId, fromId),
              )
            }
          />
        </Suspense>
      ) : null}
      {showTo != null ? (
        <Suspense fallback={showTo ? <SheetFallback /> : null}>
          <ToSheet
            key={toLoad}
            open={showTo}
            from={trip.from}
            to={trip.to}
            onPick={(id) => open(fromId, id)}
            onClose={() => setShowTo(false)}
          />
        </Suspense>
      ) : null}
      {showSelector ? (
        <Suspense fallback={<SheetFallback />}>
          <StopSelector
            initial={normalisePair({ outbound: trip.from, inbound: trip.to ?? { id: '', name: '' } })}
            fetcher={fetcher}
            onSave={save}
            onClose={() => setShowSelector(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
