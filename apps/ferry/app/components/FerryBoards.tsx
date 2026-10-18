/**
 * The two departure boards for the selected pair (legacy App.jsx): status strip with All/Express, Map and Refresh,
 * rtState/offline banners, "Depart from" time, dropdown headers with swap, details sheet, live map and the stop
 * selector. Rendered on the server with the loader's rows, then polled every 15 s while visible.
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  FilterPills,
  formatAge,
  formatClock,
  OfflineBanner,
  PillButton,
  StatusStrip,
  StopSelect,
} from '@bft/ui'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { applyFilter, asScheduled, boardState, hasExpress, type ServiceFilter } from '../lib/departures.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import {
  FIXTURE_COOKIE,
  readDepartAt,
  readSavedPair,
  savePair,
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

const LiveMapSheet = lazy(() => import('./LiveMapSheet.tsx'))
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
    if (!terminalPage) {
      const saved = readSavedPair()
      if (
        saved &&
        (saved.outbound.id !== serverPair.outbound.id || saved.inbound.id !== serverPair.inbound.id)
      ) {
        setPair(saved)
      }
      if (shouldShowSelector()) setShowSelector(true)
    }
    setDepartAt(readDepartAt())
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in Safari; this is a plain preference cookie.
    document.cookie = `${FIXTURE_COOKIE}=${mode.fixtures ? '1' : '0'}; path=/; samesite=lax`
  }, [terminalPage, serverPair, mode.fixtures])

  const same = (a: StopPair, b: StopPair) => a.outbound.id === b.outbound.id && a.inbound.id === b.inbound.id
  const useInitial = same(pair, serverPair) && departAt == null
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
  const view = (q: typeof out) => {
    const list = q.data?.departures ?? null
    if (!list) return null
    const shown = offline || q.data?.rtState === 'unavailable' ? list.map(asScheduled) : list
    return applyFilter(shown, filter)
  }
  const outList = view(out)
  const backList = view(back)
  const express = hasExpress(out.data?.departures, back.data?.departures)
  const latest = out.data ?? back.data
  const state = boardState(latest, offline)
  const live = !offline && latest?.rtState === 'live'
  const updatedAt = Math.max(out.dataUpdatedAt || 0, back.dataUpdatedAt || 0)
  const fetching = out.isFetching || back.isFetching

  const refresh = useCallback(() => {
    void out.refetch()
    void back.refetch()
  }, [out, back])

  const changePair = (next: StopPair) => {
    setPair(next)
    setSelected(null)
  }

  const save = (next: StopPair, remember: boolean) => {
    savePair(next, remember)
    setShowSelector(false)
    setDepartAt(null)
    writeDepartAt(null)
    changePair(next)
  }

  // Recompute the "Depart from" slots once an hour, not on every clock tick.
  const hour = Math.floor(now / 3_600_000)
  const slots = useMemo(() => generateTimeSlots(hour * 3_600_000), [hour])
  const departSelect = (
    <label className="flex items-center gap-2 text-xs font-medium text-aqua-text md:text-sm">
      <span>Depart from:</span>
      <select
        value={departAt ?? ''}
        onChange={(e) => {
          const v = e.target.value ? Number(e.target.value) : null
          setDepartAt(v)
          writeDepartAt(v)
        }}
        className="h-9 rounded-button border-2 border-ferry-orange/30 bg-white px-2 font-semibold text-aqua-text hover:border-ferry-orange"
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
            trailing={<div className="md:hidden">{departSelect}</div>}
            departures={outList}
            destinationName={pair.inbound.name}
            nowMs={now}
            loading={out.isPending}
            error={out.isError}
            onRetry={() => void out.refetch()}
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
              destinationName={pair.outbound.name}
              nowMs={now}
              loading={back.isPending}
              error={back.isError}
              onRetry={() => void back.refetch()}
              onSelect={(d) => setSelected({ d, direction: 'inbound' })}
            />
          </div>
        </div>
      </main>

      {children}

      {selected ? (
        <DetailsSheet
          departure={selected.d}
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
