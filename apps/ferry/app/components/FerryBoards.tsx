/**
 * The two departure boards for the selected pair (legacy App.jsx): status strip with All/Express, Map and Refresh,
 * rtState/offline banners, "Depart from" time, dropdown headers with swap, details sheet, live map and the stop
 * selector. Rendered on the server with the loader's rows, then polled every 15 s while visible.
 */

import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  DemoExitLink,
  FilterPills,
  formatAge,
  formatClock,
  OfflineBanner,
  PillButton,
  StatusStrip,
  StopSelect,
  useFixtureCookie,
} from '@bft/ui'
import { useUnconfirmedBefore } from '@bft/ui/connectivity'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyFilter,
  asScheduled,
  bannerState,
  boardState,
  hasExpress,
  type ServiceFilter,
  visibleRows,
} from '../lib/departures.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useDepartures, useFetcher, useShownData } from '../lib/queries.ts'
import {
  FIXTURE_COOKIE,
  markSelectorSeen,
  readDepartAt,
  readSavedPair,
  shouldShowSelector,
  writeDepartAt,
} from '../lib/storage.ts'
import {
  type StopPair,
  swapPair,
  TERMINALS,
  validDestinations,
  withDestination,
  withOrigin,
} from '../lib/terminals.ts'
import { generateTimeSlots } from '../lib/timeSlots.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { SiteHeader } from './Chrome.tsx'
import { DepartureList } from './DepartureList.tsx'
import { DetailsSheet } from './DetailsSheet.tsx'

// If the map sheet's chunk can't load, the board stays up (the Map button just does nothing).
const NoMap = (() => null) as never // renders nothing, whatever the props
const LiveMapSheet = lazy(() => import('./LiveMapSheet.tsx').catch(() => ({ default: NoMap })))
const StopSelector = lazy(() => import('./StopSelector.tsx'))

export interface FerryBoardsProps {
  /** Pair the server rendered (cookie pair, terminal page pair, or the default). */
  pair: StopPair
  outbound: DeparturesResponse | null
  inbound: DeparturesResponse | null
  /** Server render time, epoch ms (hydration-stable clock). */
  renderedAt: number
  mode: DataMode
  /** Terminal pages fix the origin and never open the selector on load. */
  terminalPage?: boolean
  /** The pair came from a ?from=&to= link: keep it (not the saved pair) and don't open the selector (R3-F2). */
  deepLink?: boolean
  children?: ReactNode
}

const ALL_STOPS = TERMINALS.map((t) => ({ id: t.id, name: t.name }))

function SheetFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="status">
      <span className="rounded-card bg-white px-6 py-4 text-sm shadow-lg">Loading…</span>
    </div>
  )
}

export function FerryBoards({
  pair: serverPair,
  outbound,
  inbound,
  renderedAt,
  mode,
  terminalPage,
  deepLink,
  children,
}: FerryBoardsProps) {
  const [pair, setPair] = useState(serverPair)
  const [filter, setFilter] = useState<ServiceFilter>('all')
  const [departAt, setDepartAt] = useState<number | null>(null)
  const [selected, setSelected] = useState<{ d: Departure; direction: 'outbound' | 'inbound' } | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [showSelector, setShowSelector] = useState(false)
  const now = useNow(renderedAt, 5_000)
  const online = useOnline()
  const fetcher = useFetcher(mode)

  // After hydration: saved pair (home only), first-visit selector, session "Depart from", fixture cookie.
  useEffect(() => {
    if (!terminalPage && !deepLink) {
      const saved = readSavedPair()
      if (
        saved &&
        (saved.outbound.id !== serverPair.outbound.id || saved.inbound.id !== serverPair.inbound.id)
      ) {
        setPair(saved)
      }
      if (shouldShowSelector()) {
        setShowSelector(true)
        markSelectorSeen()
      }
    }
    setDepartAt(readDepartAt())
  }, [terminalPage, deepLink, serverPair])
  // Demo mode lasts an hour from ?fixtures=1 and ends with ?fixtures=0. Never from the data mode alone: an API
  // failure that fell back to fixtures (FIXTURE_FALLBACK) used to make demo mode stick for the session (R7-B1).
  useFixtureCookie(FIXTURE_COOKIE, mode.fixtures, mode.forced === true, mode.allowed === true)

  const useInitial =
    pair.outbound.id === serverPair.outbound.id &&
    pair.inbound.id === serverPair.inbound.id &&
    departAt == null
  const out = useDepartures(
    fetcher,
    mode,
    pair.outbound.id,
    pair.inbound.id,
    departAt,
    useInitial ? outbound : null,
  )
  const back = useDepartures(
    fetcher,
    mode,
    pair.inbound.id,
    pair.outbound.id,
    departAt,
    useInitial ? inbound : null,
  )

  const offline = !online
  // Data that came with a cached page isn't live until its board's own fresh answer arrives (R2-T7).
  const unconfirmedBefore = useUnconfirmedBefore()
  const stateOf = (q: typeof out) => boardState(q.data, offline, now, unconfirmedBefore)
  // Offline, a board shows the best copy on hand: its data, or the copy kept on this device. After an offline reload
  // its data is the cached page's (maybe last night's, every row gone) until the first poll (R6-B1). Read only once
  // the board is offline, after hydration, so the first render still matches the HTML, and once per change, not per
  // tick (L8); which copy is best still depends on the time.
  const holds = (q: typeof out) => departAt == null && stateOf(q) === 'offline'
  const outData = useShownData(out.data, pair.outbound.id, pair.inbound.id, holds(out), now)
  const backData = useShownData(back.data, pair.inbound.id, pair.outbound.id, holds(back), now)
  const view = (q: typeof out, data: typeof outData) =>
    data ? applyFilter(visibleRows(data.departures, stateOf(q), now), filter) : null
  const outList = view(out, outData)
  const backList = view(back, backData)
  const express = hasExpress(outData?.departures, backData?.departures)
  const latest = outData ?? backData
  const outState = stateOf(out)
  const backState = stateOf(back)
  const state = bannerState(out.data ? [outState, back.data ? backState : null] : [backState])
  // Every board with data is live (after a cached page each board confirms itself with its own data, R2-T7): the
  // header's LIVE and the map, which shows both directions.
  const boardsLive = [out, back].every((q) => !q.data || stateOf(q) == null)
  const live = latest?.rtState === 'live' && boardsLive
  // The time of the data shown (a service-worker copy keeps its own time), not when it was fetched.
  const updatedAt = Math.max(outData?.generatedAt ?? 0, backData?.generatedAt ?? 0)
  const fetching = out.isFetching || back.isFetching

  const refresh = useCallback(() => {
    void out.refetch()
    void back.refetch()
  }, [out, back])

  const changePair = (next: StopPair) => {
    setPair(next)
    setSelected(null)
  }

  // The selector has saved the pair (savePair).
  const save = (next: StopPair) => {
    setShowSelector(false)
    setDepartAt(null)
    writeDepartAt(null)
    changePair(next)
  }

  // Recompute the "Depart from" slots once an hour, not on every clock tick.
  const hour = Math.floor(now / 3_600_000)
  const slots = useMemo(() => generateTimeSlots(hour * 3_600_000), [hour])
  const departSelect = (
    <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-aqua-text md:text-sm">
      <span className="shrink-0">Depart from:</span>
      <select
        value={departAt ?? ''}
        onChange={(e) => {
          const v = e.target.value ? Number(e.target.value) : null
          setDepartAt(v)
          writeDepartAt(v)
        }}
        className="h-9 min-w-0 truncate rounded-button border-2 border-ferry-orange/30 bg-white px-2 font-semibold text-aqua-text hover:border-ferry-orange"
      >
        <option value="">Now</option>
        {slots.map((s) =>
          s.type === 'separator' ? (
            <option key="sep" disabled value="sep">
              {s.label}
            </option>
          ) : (
            <option key={s.at} value={s.at}>
              {s.label}
            </option>
          ),
        )}
      </select>
    </label>
  )

  const destOptions = ALL_STOPS.filter((s) => validDestinations(pair.outbound.id).includes(s.id))
  const fromName = cleanStopName(pair.outbound.name)
  const toName = cleanStopName(pair.inbound.name)
  // The open details sheet follows the latest data and the freshness of its own board (Codex review).
  const selectedQ = selected?.direction === 'outbound' ? out : back
  const degraded = stateOf(selectedQ) != null
  const selectedNow = (() => {
    if (!selected) return null
    const list = selectedQ.data?.departures ?? []
    const fresh =
      list.find(
        (x) => x.tripInstance === selected.d.tripInstance && x.stopSequence === selected.d.stopSequence,
      ) ?? selected.d
    return degraded ? asScheduled(fresh) : fresh
  })()
  const selectedTo = selected?.direction === 'outbound' ? pair.inbound : pair.outbound
  const selectedFrom = selected?.direction === 'outbound' ? pair.outbound : pair.inbound

  return (
    <>
      <SiteHeader onSettings={() => setShowSelector(true)} live={live} />
      <StatusStrip
        updated={`Last updated ${updatedAt ? formatClock(Math.floor(updatedAt / 1000)) : formatClock(Math.floor(renderedAt / 1000))}`}
        detail={formatAge(latest?.rtSourceTimestamp ?? null, now)}
      >
        {express || filter === 'express' ? (
          <FilterPills
            label="Services"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'express', label: 'Express' },
            ]}
          />
        ) : null}
        <PillButton icon="map" pressed={showMap} onClick={() => setShowMap((v) => !v)}>
          Map
        </PillButton>
        <PillButton icon="refresh" label="Refresh" onClick={refresh} disabled={fetching}>
          <span className="sr-only md:not-sr-only">Refresh</span>
        </PillButton>
      </StatusStrip>

      <main className="mx-auto max-w-6xl px-3 py-5 md:px-4 md:py-8">
        <div
          className={`mb-4 flex-col gap-2 md:flex md:min-h-12 md:flex-row md:items-center md:justify-between ${state ? 'flex' : 'hidden'}`}
        >
          {state ? <OfflineBanner kind={state} /> : <span className="hidden md:block" />}
          <div className="hidden md:block">{departSelect}</div>
        </div>

        {mode.fixtures ? (
          <p
            role="note"
            data-banner="demo"
            className="mb-4 rounded-card border border-aqua-text/30 bg-ferry-light-blue px-3.5 py-2.5 text-sm text-charcoal"
          >
            <strong className="font-bold">Demo data.</strong> A recorded weekday timetable with simulated live
            times, not today's real departures. <DemoExitLink />
          </p>
        ) : null}

        {/* Phone: origin and destination dropdowns with swap; one board (outbound). */}
        <div className="mb-3 flex items-center gap-2 rounded-card border-2 border-ferry-orange/30 bg-white/90 px-2.5 py-2 shadow-lg md:hidden">
          <StopSelect
            label="From"
            value={pair.outbound.id}
            options={ALL_STOPS}
            onChange={(id) => changePair(withOrigin(pair, id))}
          />
          <button
            type="button"
            onClick={() => changePair(swapPair(pair))}
            aria-label="Swap direction"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-ferry-orange-dark hover:bg-ferry-orange-light"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <StopSelect
            label="To"
            value={pair.inbound.id}
            options={destOptions}
            onChange={(id) => changePair(withDestination(pair, id))}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 md:gap-8">
          <DepartureList
            id="outbound"
            label={`${fromName} to ${toName}`}
            header={
              <>
                <span className="truncate md:hidden">
                  {fromName} → {toName}
                </span>
                <span className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
                  <StopSelect
                    label="From"
                    value={pair.outbound.id}
                    options={ALL_STOPS}
                    onChange={(id) => changePair(withOrigin(pair, id))}
                  />
                  <span aria-hidden="true">→</span>
                  <StopSelect
                    label="To"
                    value={pair.inbound.id}
                    options={destOptions}
                    onChange={(id) => changePair(withDestination(pair, id))}
                  />
                </span>
              </>
            }
            trailing={<div className="flex min-w-0 md:hidden">{departSelect}</div>}
            departures={outList}
            nowMs={now}
            loading={out.isPending}
            error={out.isError}
            onRetry={() => void out.refetch()}
            offline={outState === 'offline'}
            onSelect={(d) => setSelected({ d, direction: 'outbound' })}
          />
          <div className="hidden md:block">
            <DepartureList
              id="inbound"
              label={`${toName} to ${fromName}`}
              header={
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <StopSelect
                    label="From"
                    value={pair.inbound.id}
                    options={ALL_STOPS}
                    onChange={(id) => changePair(withDestination(pair, id))}
                  />
                  <span aria-hidden="true">→</span>
                  <StopSelect
                    label="To"
                    value={pair.outbound.id}
                    options={ALL_STOPS}
                    onChange={(id) => changePair(withOrigin(pair, id))}
                  />
                </span>
              }
              onSwap={() => changePair(swapPair(pair))}
              departures={backList}
              nowMs={now}
              loading={back.isPending}
              error={back.isError}
              onRetry={() => void back.refetch()}
              offline={backState === 'offline'}
              onSelect={(d) => setSelected({ d, direction: 'inbound' })}
            />
          </div>
        </div>
      </main>

      {children}

      {selectedNow ? (
        <DetailsSheet
          departure={selectedNow}
          live={!degraded}
          fromName={selectedFrom.name}
          toName={selectedTo.name}
          toId={selectedTo.id}
          nowMs={now}
          fetcher={fetcher}
          mode={mode}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {showMap ? (
        <Suspense fallback={<SheetFallback />}>
          <LiveMapSheet
            pair={pair}
            live={boardsLive}
            departures={[...(out.data?.departures ?? []), ...(back.data?.departures ?? [])]}
            fetcher={fetcher}
            mode={mode}
            onClose={() => setShowMap(false)}
            onSelect={(d) => {
              setShowMap(false)
              setSelected({ d, direction: d.stopId === pair.outbound.id ? 'outbound' : 'inbound' })
            }}
          />
        </Suspense>
      ) : null}
      {showSelector ? (
        <Suspense fallback={<SheetFallback />}>
          <StopSelector initial={pair} onSave={save} onClose={() => setShowSelector(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
