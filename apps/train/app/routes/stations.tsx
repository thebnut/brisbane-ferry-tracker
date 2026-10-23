/**
 * /stations (?from=&to=): choose a trip (T-Search). From = any station (uFuzzy search over data/train/stops.json in a
 * headless combobox); To = only stations with a direct train from there, grouped by line. Without a origin, the page is
 * the A–Z station index (every station page linked, for people and crawlers).
 */
import { Icon, LineChip, PrimaryButton } from '@bft/ui'
import { MapToggle } from '@bft/ui/map-toggle'
import type { StopOption } from '@bft/ui/stop-search'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { SECTION, Shell } from '../components/Chrome.tsx'
import { ReachableList } from '../components/ReachableList.tsx'
import { cleanStopName } from '../lib/names.ts'
import {
  boardHref,
  isReachable,
  linesBetween,
  reachableFrom,
  STATIONS,
  stationByKey,
  stationHref,
} from '../lib/network.ts'
import { searchStations } from '../lib/search.ts'
import { pageMeta } from '../lib/seo.ts'
import { getEnv, siteInfo } from '../lib/server.server.ts'
import { fetchStationIndex } from '../lib/stop-index.ts'
import { useMounted } from '../lib/useNow.ts'
import type { Route } from './+types/stations'

type StationPickerProps = {
  slot: string
  onClose: () => void
  notice?: string | null
  onRetry?: (() => void) | null
}

// Client-only (Ark UI): the server renders the plain fallback field, then the combobox loads after hydration.
const StopSearch = lazy(() =>
  import.meta.env.SSR
    ? new Promise<never>(() => {})
    : import('@bft/ui/stop-search').then((m) => ({ default: m.StopSearch })),
)

// The map station picker (P3): MapLibre loads only when the Map button is pressed. If its chunk can't load (offline),
// the button does nothing and the search is unchanged.
const StationPicker = lazy(() =>
  import.meta.env.SSR
    ? new Promise<never>(() => {})
    : import('../components/StationPicker.tsx').catch(() => ({
        default: (_: StationPickerProps) => null,
      })),
)

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const from = stationByKey(url.searchParams.get('from'))?.key ?? null
  const toKey = url.searchParams.get('to')
  const to = from && toKey && isReachable(from, toKey) ? toKey : null
  return { from, to, site: siteInfo(getEnv(context)) }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const site = loaderData?.site ?? { siteUrl: '', indexable: false }
  return pageMeta({
    title: 'All train stations – live departures | BrisbaneTrain',
    description: `Live departures for all ${STATIONS.length} train stations in South East Queensland. Pick a station and a destination to see only the trains that go there directly.`,
    url: `${site.siteUrl}/stations`,
    site,
  })
}

const INDEX_FAILED = "Couldn't load the station list, so search uses the built-in one."

/**
 * The station index file (pipeline output, served as a static asset; cached by the service worker). If it can't load,
 * the search uses the stations bundled with the app (network.ts).
 */
function useStopIndex() {
  return useQuery({
    queryKey: ['train', 'stops.json'],
    queryFn: ({ signal }) => fetchStationIndex(signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

const fuzzy = (query: string, options: StopOption[]) =>
  searchStations(
    query,
    options.map((o) => ({ ...o, key: o.id })),
    20,
  )

function FieldFallback({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-gray-700 dark:text-night-text/80">{label}</span>
      <input
        readOnly
        value={value}
        placeholder="Station name"
        className="h-12 w-full rounded-card border-2 border-ferry-orange/30 bg-white px-10 text-base font-semibold text-aqua-text dark:bg-night-2"
      />
    </label>
  )
}

export default function Stations({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const from = stationByKey(params.get('from') ?? loaderData.from)
  const toKey = params.get('to') ?? loaderData.to
  const to = from && toKey && isReachable(from.key, toKey) ? stationByKey(toKey) : null
  const index = useStopIndex()
  const mounted = useMounted()
  const options: StopOption[] = useMemo(
    () =>
      (
        index.data?.stops.map((s) => ({ id: s.key, name: cleanStopName(s.name) })) ??
        STATIONS.map((s) => ({ id: s.key, name: s.name }))
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [index.data],
  )
  const toOptions: StopOption[] = useMemo(() => {
    if (!from) return []
    const seen = new Map<string, StopOption>()
    for (const g of reachableFrom(from.key))
      for (const s of g.stations) seen.set(s.key, { id: s.key, name: s.name, detail: g.line.name })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [from])

  const set = (f: string | null, t: string | null) => {
    const next = new URLSearchParams()
    if (f) next.set('from', f)
    if (t) next.set('to', t)
    setParams(next, { replace: true })
  }
  const lines = from && to ? linesBetween(from.key, to.key) : []
  const [map, setMap] = useState(false)
  // On phones the map sheet covers the page's notice below, so the sheet shows it too: one query, so Try again from
  // either place clears both.
  const picker = (slot: 'wide' | 'narrow') =>
    map ? (
      <Suspense fallback={null}>
        <StationPicker
          slot={slot}
          onClose={() => setMap(false)}
          notice={index.isError ? INDEX_FAILED : null}
          onRetry={index.isError ? () => index.refetch() : null}
        />
      </Suspense>
    ) : null

  return (
    <Shell active="stations">
      <div className={map ? 'mx-auto flex max-w-6xl items-start gap-4' : undefined}>
        {/* With the map open, search and map share the width (min-w-0), so neither is squeezed on a tablet. */}
        <div
          className={
            map ? 'flex min-w-0 flex-1 flex-col gap-3' : 'mx-auto flex w-full max-w-2xl flex-col gap-3'
          }
        >
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-extrabold">Choose your trip</h1>
            <MapToggle open={map} onToggle={setMap} noun="stations" />
          </div>
          <div className="flex flex-col gap-3 rounded-card bg-white/90 p-3.5 shadow-card dark:bg-night-card">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {mounted ? (
                  <Suspense fallback={<FieldFallback label="From" value={from?.name ?? ''} />}>
                    <StopSearch
                      label="From"
                      placeholder="Station name"
                      options={options}
                      value={from?.key ?? null}
                      filter={fuzzy}
                      onChange={(k) => set(k, to && isReachable(k, to.key) ? to.key : null)}
                    />
                  </Suspense>
                ) : (
                  <FieldFallback label="From" value={from?.name ?? ''} />
                )}
              </div>
              <button
                type="button"
                aria-label="Swap origin and destination"
                disabled={!from || !to || !isReachable(to.key, from.key)}
                onClick={() => from && to && set(to.key, from.key)}
                className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border border-ferry-orange/30 bg-white text-ferry-orange-dark disabled:opacity-40 dark:bg-night-2"
              >
                <Icon name="swap" size={20} className="rotate-90" />
              </button>
            </div>
            {from && !mounted ? <FieldFallback label="To" value={to?.name ?? ''} /> : null}
            {from && mounted ? (
              <Suspense fallback={<FieldFallback label="To" value={to?.name ?? ''} />}>
                <StopSearch
                  label="To"
                  placeholder="Where are you going?"
                  options={toOptions}
                  value={to?.key ?? null}
                  filter={fuzzy}
                  onChange={(k) => set(from.key, k)}
                />
              </Suspense>
            ) : null}
            {index.isError ? (
              <p role="status" className="flex flex-wrap items-center gap-x-2 text-[13px] text-sched-text">
                {INDEX_FAILED}
                <button
                  type="button"
                  onClick={() => index.refetch()}
                  className="font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
                >
                  Try again
                </button>
              </p>
            ) : null}
          </div>

          {from ? (
            <p className="flex items-center gap-2 px-0.5 text-[13px] text-gray-700 dark:text-night-text/80">
              <Icon name="info" size={16} className="shrink-0 text-aqua-text" />
              Only stations with a direct train from {from.name} are shown.
            </p>
          ) : null}

          {from && to ? (
            <div
              className="bg-hot flex items-center gap-3 rounded-card border-2 border-ferry-orange px-4 py-3.5"
              data-testid="trip-match"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-lg font-extrabold">
                  {from.name} → {to.name}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {lines.map((l) => (
                    <LineChip key={l.name} name={l.name} color={l.color} />
                  ))}
                </span>
              </div>
              <PrimaryButton onClick={() => navigate(boardHref(from.key, to.key))}>Show trains</PrimaryButton>
            </div>
          ) : null}

          {from ? (
            <>
              <h2 className={`${SECTION.h2} mt-1.5`}>Reachable from {from.name}, by line</h2>
              <ReachableList from={from} selected={to?.key ?? null} onPick={(k) => set(from.key, k)} />
              <Link
                to={stationHref(from.key)}
                className="self-start text-sm font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
              >
                All departures from {from.name}
              </Link>
            </>
          ) : (
            <section aria-labelledby="all-stations">
              <h2 id="all-stations" className={`${SECTION.h2} mt-1.5`}>
                All {STATIONS.length} stations
              </h2>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-3">
                {[...STATIONS]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <li key={s.key}>
                      <Link
                        className="block py-1.5 text-aqua-text hover:text-ferry-orange-deep dark:text-ferry-aqua-light"
                        to={stationHref(s.key)}
                      >
                        {s.name}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
        {picker('wide')}
      </div>
      {picker('narrow')}
    </Shell>
  )
}
