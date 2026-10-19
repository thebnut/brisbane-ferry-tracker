/**
 * Search-first stop finder (B-Home, B-Search, B-Desktop). Phones: the "Stop name or number" field sits in a sheet at
 * thumb height above the bottom navigation and results stack upward, best match nearest the thumb. Desktop: the
 * field is in the status strip and results drop down.
 *
 * The 12k-stop index loads lazily after first paint (or on focus) and the service worker keeps it. Each search's
 * duration is recorded on `window.__bftSearch` for the Playwright performance check.
 */
import { SearchField, StopResultCard, ThumbSheet } from '@bft/ui/bus'
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { StopIndexEntry } from '../lib/data-contract.ts'
import { useApi } from '../lib/mode.ts'
import { useStopIndex } from '../lib/queries.ts'
import { type SearchIndex, type SearchResult, searchStops } from '../lib/search.ts'
import { stopCode, stopHref } from '../lib/stops.ts'
import { readRecent, type SavedStop } from '../lib/storage.ts'
import { linkRenderer } from './StopBoard.tsx'

declare global {
  interface Window {
    __bftSearch?: { times: number[]; ready: boolean }
  }
}

function timedSearch(index: SearchIndex, q: string): SearchResult {
  const t0 = performance.now()
  const r = searchStops(index, q, 20)
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
  // Lazy: after first paint (idle), or immediately once the user types.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    const start = () => setEnabled(true)
    if (w.requestIdleCallback) w.requestIdleCallback(start)
    else setTimeout(start, 200)
  }, [])
  useEffect(() => {
    if (query) setEnabled(true)
  }, [query])
  const idx = useStopIndex(fetcher, mode, enabled)
  const deferred = useDeferredValue(query)
  const result = useMemo(() => {
    const q = deferred.trim()
    if (!idx.index || !q || (q.length < 2 && !/^\d$/.test(q))) return null
    return timedSearch(idx.index, q)
  }, [idx.index, deferred])
  useEffect(() => {
    if (idx.index) {
      window.__bftSearch ??= { times: [], ready: true }
      window.__bftSearch.ready = true
    }
  }, [idx.index])
  return { result, loading: enabled && idx.isPending, error: idx.isError, index: idx }
}

function Results({
  query,
  result,
  loading,
  error,
  upward,
}: {
  query: string
  result: SearchResult | null
  loading: boolean
  error: boolean
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
  return (
    <div className="flex flex-col gap-2.5">
      {header}
      <ul
        aria-label="Matching stops"
        className={upward ? 'flex flex-col-reverse gap-2.5' : 'flex flex-col gap-2.5'}
      >
        {items}
      </ul>
    </div>
  )
}

export function SearchPanel({ children, quick }: { children: ReactNode; quick?: ReactNode }) {
  const [query, setQuery] = useState('')
  const { result, loading, error } = useStopSearch(query)
  const [recent, setRecent] = useState<SavedStop[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => setRecent(readRecent().slice(0, 2)), [])
  // Results stack upward: keep the best match (bottom) in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when results change.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [result])
  const searching = query.trim().length > 0
  return (
    <>
      {/* Desktop: field in the strip, results drop down over the page. */}
      <div className="mx-auto hidden max-w-6xl px-4 pt-4 md:block">
        <SearchField
          label="Stop name or number"
          placeholder="Stop name or number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          compact
          id="stop-search-desktop"
        />
        {searching ? (
          <div className="mt-3 max-w-2xl">
            <Results query={query} result={result} loading={loading} error={error} upward={false} />
          </div>
        ) : null}
      </div>
      <div className={searching ? 'hidden md:block' : undefined}>{children}</div>
      {/* Phones: results stack upward above the thumb-height sheet. */}
      {searching ? (
        <div
          ref={scroller}
          className="bg-page fixed inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom)+var(--bft-bottom-bar,58px)+166px)] z-30 overflow-y-auto px-4 pt-20 pb-3 md:hidden"
        >
          <div className="flex min-h-full flex-col justify-end">
            <Results query={query} result={result} loading={loading} error={error} upward />
          </div>
        </div>
      ) : null}
      <div className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),6px)+var(--bft-bottom-bar,58px))] z-30 md:hidden">
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
              {quick}
              {recent.map((r) => (
                <Link
                  key={r.id}
                  to={stopHref(r.id)}
                  className="flex min-h-10 shrink-0 items-center rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-[13px] font-semibold whitespace-nowrap text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light"
                >
                  Recent: {r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name}
                </Link>
              ))}
            </div>
          </div>
        </ThumbSheet>
      </div>
    </>
  )
}
