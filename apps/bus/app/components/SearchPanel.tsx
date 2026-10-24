/**
 * Search-first stop finder (B-Home, B-Search, B-Desktop). Phones: the "Stop name or number" field sits in a sheet at
 * thumb height above the bottom navigation and results stack upward, best match nearest the thumb. Desktop: the
 * field is in the status strip and results drop down. Inside BrisbaneTransit (`BASE` set) the five Mode Tabs are the
 * only bottom layer (THE-118 PR 3), so there is no sheet: the field sits at the top of the page at every width, with
 * the desktop layout.
 *
 * The 12k-stop index loads lazily after first paint (or on focus) and the service worker keeps it. Each search's
 * duration is recorded on `window.__bftSearch` for the Playwright performance check.
 */
import { SearchField, StopResultCard, ThumbSheet } from '@bft/ui/bus'
import { MapToggle } from '@bft/ui/map-toggle'
import { useQueryClient } from '@tanstack/react-query'
import { lazy, type ReactNode, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { BASE } from '../lib/base.ts'
import type { StopIndexEntry } from '../lib/data-contract.ts'
import { useApi } from '../lib/mode.ts'
import { retryFailedLists, useStopIndex } from '../lib/queries.ts'
import type { SearchIndex, SearchResult, searchStops } from '../lib/search.ts'
import { stopCode, stopHref } from '../lib/stops.ts'
import { readRecent, type SavedStop } from '../lib/storage.ts'
import { linkRenderer } from './StopBoard.tsx'

declare global {
  interface Window {
    __bftSearch?: { times: number[]; ready: boolean }
  }
}

/** The Routes group (P2): its own chunk, loaded on the first keystroke; if it can't load, stop search is unchanged. */
const RouteResults = lazy(() =>
  import('./RouteResults.tsx').catch(() => ({
    default: (_: { query: string; slot: string; onRetry: () => void }) => null,
  })),
)

/**
 * The map stop picker (P3): MapLibre and the geo tiles load only when the Map button is pressed, never on the server.
 * If its chunk can't load (offline), the button does nothing and the search is unchanged.
 */
const BusStopPicker = lazy(() =>
  import.meta.env.SSR
    ? new Promise<never>(() => {})
    : import('./BusStopPicker.tsx').catch(() => ({
        default: (_: { slot: string; onClose: () => void; onRetry: () => void }) => null,
      })),
)

function timedSearch(search: typeof searchStops, index: SearchIndex, q: string): SearchResult {
  const t0 = performance.now()
  const r = search(index, q, 20)
  const ms = performance.now() - t0
  window.__bftSearch ??= { times: [], ready: true }
  window.__bftSearch.times.push(ms)
  return r
}

export function resultMeta(e: StopIndexEntry): string {
  const code = e.code ?? stopCode(e.key)
  const plat = e.platforms?.[0]?.code
  return [code ? `Stop ${code}` : null, plat ? `platform ${plat}` : null].filter(Boolean).join(' · ')
}

export function useStopSearch(query: string) {
  const { mode, fetcher } = useApi()
  const [enabled, setEnabled] = useState(false)
  // Lazy: after first paint (idle), or immediately once the user types. Cancelled on unmount, so it never fires late.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number
      cancelIdleCallback?: (id: number) => void
    }
    const start = () => setEnabled(true)
    // Idle only where it can be cancelled too; otherwise the timer, which can.
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const id = w.requestIdleCallback(start)
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(start, 200)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (query) setEnabled(true)
  }, [query])
  const idx = useStopIndex(fetcher, mode, enabled)
  const deferred = useDeferredValue(query)
  const result = useMemo(() => {
    const q = deferred.trim()
    if (!idx.index || !idx.searchStops || !q || (q.length < 2 && !/^\d$/.test(q))) return null
    return timedSearch(idx.searchStops, idx.index, q)
  }, [idx.index, idx.searchStops, deferred])
  useEffect(() => {
    if (idx.index) {
      window.__bftSearch ??= { times: [], ready: true }
      window.__bftSearch.ready = true
    }
  }, [idx.index])
  return {
    result,
    loading: enabled && !idx.isError && !idx.index,
    error: idx.isError,
    retry: idx.retry,
    index: idx,
  }
}

function Results({
  query,
  result,
  loading,
  error,
  onRetry,
  upward,
}: {
  query: string
  result: SearchResult | null
  loading: boolean
  error: boolean
  onRetry: () => void
  upward: boolean
}) {
  if (!query.trim()) return null
  const header = (
    <div
      className="bg-board-header flex justify-between gap-2 rounded-card border border-ferry-orange/10 px-3.5 py-2.5 text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light"
      role="status"
      aria-live="polite"
    >
      <span>
        {loading
          ? 'Loading stops…'
          : error
            ? "Couldn't load the stop list"
            : !result
              ? 'Keep typing…'
              : result.hits.length === 0
                ? `No stops match “${query.trim()}”`
                : `${result.total > result.hits.length ? `${result.hits.length} of ${result.total}` : result.hits.length} stop${result.hits.length === 1 ? '' : 's'} match “${query.trim()}”`}
      </span>
      {error && !loading ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-ferry-orange-deep underline dark:text-ferry-sunset"
        >
          Try again
        </button>
      ) : null}
      {upward && result?.hits.length ? (
        <span className="hidden font-medium text-sched-text sm:inline">Best match nearest your thumb</span>
      ) : null}
    </div>
  )
  const hits = result?.hits ?? []
  const items = hits.map((e, i) => (
    <StopResultCard
      key={e.key}
      name={e.name}
      meta={resultMeta(e)}
      platform={e.platforms?.[0]?.code}
      routes={e.routes}
      best={i === 0}
      href={stopHref(e.key)}
      renderLink={linkRenderer}
    />
  ))
  const routes = (slot: 'above' | 'below') => (
    <Suspense fallback={null}>
      <RouteResults query={query} slot={slot} onRetry={onRetry} />
    </Suspense>
  )
  return (
    <div className="flex flex-col gap-2.5">
      {header}
      {routes('above')}
      <ul
        aria-label="Matching stops"
        className={upward ? 'flex flex-col-reverse gap-2.5' : 'flex flex-col gap-2.5'}
      >
        {items}
      </ul>
      {routes('below')}
    </div>
  )
}

function recentChip(r: SavedStop) {
  return (
    <Link
      key={r.id}
      to={stopHref(r.id)}
      className="flex min-h-10 shrink-0 items-center rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-[13px] font-semibold whitespace-nowrap text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light"
    >
      Recent: {r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name}
    </Link>
  )
}

/**
 * The home's `<main>`: its title, the search and the page (`children`), as on Ferry and Train, so the h1 and the
 * search field are in the main landmark. The footer comes after it.
 */
export function SearchPanel({
  title,
  children,
  footer,
  quick,
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  quick?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const { result, loading, error, retry } = useStopSearch(query)
  const client = useQueryClient()
  // Every Try again here (stop list, routes, map) retries every list that failed, so one press brings them all back.
  const retryAll = () => {
    retry()
    void retryFailedLists(client)
  }
  const [recent, setRecent] = useState<SavedStop[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => setRecent(readRecent().slice(0, 2)), [])
  // Results stack upward: keep the best match (bottom) in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when results change.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [result])
  const [map, setMap] = useState(false)
  const searching = query.trim().length > 0
  const toggle = <MapToggle open={map} onToggle={setMap} />
  // BrisbaneTransit: no thumb-height sheet, the desktop layout at every width (fixed per build, never a runtime switch).
  const top = !!BASE
  const picker = (slot: 'wide' | 'narrow') =>
    map ? (
      <Suspense fallback={null}>
        <BusStopPicker slot={slot} onClose={() => setMap(false)} onRetry={retryAll} />
      </Suspense>
    ) : null
  return (
    <>
      <main>
        {title}
        {/* Desktop: field in the strip, results drop down over the page, the map beside them. */}
        <div className={top ? 'mx-auto max-w-6xl px-4 pt-4' : 'mx-auto hidden max-w-6xl px-4 pt-4 md:block'}>
          <div className="flex items-end gap-2">
            <SearchField
              label="Stop name or number"
              placeholder="Stop name or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery('')}
              compact
              id="stop-search-desktop"
              className="flex-1"
            />
            {toggle}
          </div>
          {top && (quick || recent.length) ? (
            <div className="mt-2.5 flex gap-2 overflow-x-auto [&>a]:min-h-11">
              {quick}
              {recent.map(recentChip)}
            </div>
          ) : null}
          {searching || map ? (
            <div className="mt-3 flex items-start gap-4">
              {searching ? (
                <div className="max-w-2xl flex-1">
                  <Results
                    query={query}
                    result={result}
                    loading={loading}
                    error={error}
                    onRetry={retryAll}
                    upward={false}
                  />
                </div>
              ) : null}
              {picker('wide')}
            </div>
          ) : null}
        </div>
        <div className={searching && !top ? 'hidden md:block' : undefined}>{children}</div>
        {top ? null : (
          <>
            {/* Phones: results stack upward above the thumb-height sheet. */}
            {searching ? (
              <div
                ref={scroller}
                className="bg-page fixed inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom)+var(--bft-bottom-bar,58px)+166px)] z-30 overflow-y-auto px-4 pt-20 pb-3 md:hidden"
              >
                <div className="flex min-h-full flex-col justify-end">
                  <Results
                    query={query}
                    result={result}
                    loading={loading}
                    error={error}
                    onRetry={retryAll}
                    upward
                  />
                </div>
              </div>
            ) : null}
            <div
              data-bft-dock=""
              className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),6px)+var(--bft-bottom-bar,58px))] z-30 md:hidden"
            >
              <ThumbSheet label="Find a stop" className="pb-3">
                <div className="flex flex-col gap-2.5">
                  <SearchField
                    label={searching ? 'Stop name or number' : 'Find a stop'}
                    placeholder="Stop name or number"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClear={() => setQuery('')}
                    id="stop-search"
                  />
                  <div className="flex gap-2 overflow-x-auto">
                    {toggle}
                    {quick}
                    {recent.map(recentChip)}
                  </div>
                </div>
              </ThumbSheet>
            </div>
          </>
        )}
        {picker('narrow')}
      </main>
      {/* The footer, not the content, clears the fixed sheet: it comes last. */}
      {footer ? <div className={searching && !top ? 'hidden md:block' : undefined}>{footer}</div> : null}
    </>
  )
}
