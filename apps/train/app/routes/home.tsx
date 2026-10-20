/**
 * Home (T-Home): "Your trips" (favourites; the first few are server-rendered from the bft_fav cookie), the nearest
 * station with its next train per line (on request, from the device location), and popular stations for first
 * visits. Favourites' full-day timetables are saved for offline use in the background.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import {
  CountdownChip,
  formatClock,
  Icon,
  LineChip,
  minutesUntil,
  PlatformTile,
  SecondaryButton,
  StatusBadge,
  StoppingPattern,
} from '@bft/ui'
import { usePageCheck } from '@bft/ui/connectivity'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { SECTION, Shell, useReportLive } from '../components/Chrome.tsx'
import { boardHref } from '../components/StationBoard.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { boardState, effectiveDep, trainCard, visibleRows } from '../lib/departures.ts'
import { lineLabel } from '../lib/lineNames.ts'
import { STATIONS, type Station, stationByKey, stationHref } from '../lib/network.ts'
import { canPrefetch, prefetchFavourites } from '../lib/offline.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import { HOME_META, homeJsonLd, pageMeta } from '../lib/seo.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
import { type Favourite, favouriteId, favouritesFromCookie, readFavourites } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/home'

const POPULAR = [
  'central',
  'roma-street',
  'fortitude-valley',
  'bowen-hills',
  'south-brisbane',
  'domestic-airport',
]

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
  const favourites = favouritesFromCookie(request.headers.get('cookie')).filter((f) => stationByKey(f.from))
  const boards = await Promise.all(
    favourites.map((f) =>
      settle((signal) =>
        fetchDepartures(fetcher, f.from, f.to, { limit: 4, signal, validate: validateDepartures }),
      ),
    ),
  )
  return {
    favourites,
    boards: Object.fromEntries(favourites.map((f, i) => [favouriteId(f), boards[i] ?? null])),
    renderedAt: Date.now(),
    mode: { fixtures, rt },
    site: siteInfo(env),
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const site = loaderData?.site ?? { siteUrl: '', indexable: false }
  return [
    ...pageMeta({ ...HOME_META, url: `${site.siteUrl}/`, site }),
    { 'script:ld+json': homeJsonLd(site.siteUrl) },
  ]
}

/** A query's rows as the board would show them (timetable only unless live, departed trains dropped). */
function useLiveRows(key: string, q: ReturnType<typeof useDepartures>, nowMs: number) {
  const online = useOnline()
  const page = usePageCheck()
  const state = boardState(
    q.data,
    !online || (q.data as { offline?: boolean } | undefined)?.offline === true,
    nowMs,
    page,
  )
  // The header pill is LIVE only while every board on the page is.
  useReportLive(key, state == null)
  return visibleRows(q.data?.departures ?? [], state, nowMs)
}

function FavouriteCard({
  fav,
  initial,
  nowMs,
  mode,
  primary,
}: {
  fav: Favourite
  initial: DeparturesResponse | null
  nowMs: number
  mode: DataMode
  primary: boolean
}) {
  const fetcher = useFetcher(mode)
  const q = useDepartures(fetcher, mode, fav.from, fav.to, initial, 4)
  const from = stationByKey(fav.from) as Station
  const to = stationByKey(fav.to)
  const rows = useLiveRows(`fav:${fav.from}>${fav.to ?? ''}`, q, nowMs).filter(
    (d) => d.status !== 'cancelled',
  )
  const next = rows[0] ? trainCard(rows[0], nowMs, fav.from, fav.to) : null
  const then = rows.slice(1, 3)
  return (
    <Link
      to={boardHref(fav.from, fav.to)}
      data-testid="favourite"
      className={
        primary
          ? 'bg-hot flex flex-col gap-3 rounded-card border-2 border-ferry-orange p-4 text-inherit no-underline shadow-hot'
          : 'flex flex-col gap-2.5 rounded-card bg-white/90 p-4 text-inherit no-underline shadow-card dark:bg-night-card'
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[15px] font-bold text-aqua-text dark:text-ferry-aqua-light">
          {from.name}
          {to ? ` → ${to.name}` : ''}
        </span>
        <Icon
          name="star"
          size={20}
          fill="currentColor"
          className="shrink-0 text-ferry-orange"
          title="Saved trip"
        />
      </span>
      {next ? (
        <>
          <span className="flex items-center gap-3">
            <PlatformTile platform={next.platform} scheduledPlatform={next.scheduledPlatform} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {next.badges.map((b) => (
                  <StatusBadge key={b} kind={b} />
                ))}
                {next.express ? (
                  <span className="text-[11px] font-extrabold tracking-wide text-ferry-orange-deep dark:text-ferry-sunset">
                    EXPRESS
                  </span>
                ) : null}
              </span>
              <span className="text-[22px] font-extrabold tabular">
                {next.time}
                {next.arrival ? (
                  <>
                    <span className="mx-1 font-normal text-gray-500" aria-hidden="true">
                      →
                    </span>
                    <span className="text-lg font-medium text-gray-700 dark:text-night-text/80">
                      {next.arrival.time}
                    </span>
                  </>
                ) : null}
              </span>
            </span>
            {next.minutes != null ? <CountdownChip minutes={next.minutes} /> : null}
          </span>
          {primary ? (
            <span className="flex flex-col gap-1">
              <StoppingPattern compact stops={next.strip} color={next.line.color} />
              <span className="flex justify-between text-[11px] text-gray-600 dark:text-night-text/70">
                <span>
                  {lineLabel(next.line.name)}
                  {next.scheduledPlatform ? ` · platform changed from ${next.scheduledPlatform}` : ''}
                </span>
                {next.skips ? <span>skips {next.skips}</span> : null}
              </span>
            </span>
          ) : null}
          {then.length ? (
            <span className="flex flex-wrap gap-2 border-t border-ferry-orange/20 pt-2.5 text-[13px] text-gray-700 dark:text-night-text/80">
              <span className="font-semibold">Then</span>
              {then.map((d, i) => (
                <span key={d.tripInstance} className="tabular">
                  {i > 0 ? (
                    <span className="mr-2 text-gray-400" aria-hidden="true">
                      |
                    </span>
                  ) : null}
                  {formatClock(effectiveDep(d))}
                  {d.platform ? ` · plat ${d.platform}` : ''}
                </span>
              ))}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-sm text-sched-text">
          {q.data ? 'No more trains today' : 'Loading next trains…'}
        </span>
      )}
    </Link>
  )
}

/** Haversine distance in metres. */
const metres = (lat: number, lon: number, s: Station) => {
  const r = (d: number) => (d * Math.PI) / 180
  const x =
    Math.sin(r(s.lat - lat) / 2) ** 2 +
    Math.cos(r(lat)) * Math.cos(r(s.lat)) * Math.sin(r(s.lon - lon) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(x))
}

/** Next train per line and direction at a station (the nearest-station chips). */
function NearestLines({ station, nowMs, mode }: { station: Station; nowMs: number; mode: DataMode }) {
  const fetcher = useFetcher(mode)
  const q = useDepartures(fetcher, mode, station.key, null, null, 12)
  const rows = useLiveRows(`nearest:${station.key}`, q, nowMs)
  const perLine = new Map<string, { name: string; color: string; mins: number }>()
  for (const d of rows) {
    if (d.status === 'cancelled') continue
    const c = trainCard(d, nowMs, station.key, null)
    const k = `${c.line.name}|${c.headsign}`
    if (!perLine.has(k))
      perLine.set(k, { name: c.headsign, color: c.line.color, mins: minutesUntil(effectiveDep(d), nowMs) })
  }
  return (
    <span className="flex flex-wrap gap-2">
      {[...perLine.values()].slice(0, 4).map((l) => (
        <LineChip key={l.name} name={l.name} color={l.color}>
          <span className="font-bold tabular"> {l.mins < 1 ? 'now' : `${l.mins} min`}</span>
        </LineChip>
      ))}
    </span>
  )
}

function Nearest({ nowMs, mode }: { nowMs: number; mode: DataMode }) {
  const [state, setState] = useState<{ station: Station; m: number } | 'asking' | 'denied' | null>(null)
  const station = typeof state === 'object' && state ? state.station : null
  const ask = () => {
    if (!('geolocation' in navigator)) return setState('denied')
    setState('asking')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const best = STATIONS.map((s) => ({
          station: s,
          m: metres(p.coords.latitude, p.coords.longitude, s),
        })).sort((a, b) => a.m - b.m)[0]
        setState(best ?? 'denied')
      },
      () => setState('denied'),
      { maximumAge: 5 * 60_000, timeout: 10_000 },
    )
  }
  return (
    <section
      className="flex flex-col gap-2.5 rounded-card bg-white/90 px-4 py-3.5 shadow-card dark:bg-night-card"
      aria-label="Nearest station"
    >
      {station && typeof state === 'object' && state ? (
        <>
          <Link to={stationHref(station.key)} className="flex items-center gap-2 text-inherit no-underline">
            <Icon name="pin" size={18} className="text-aqua-text" />
            <span className="text-[15px] font-bold">Nearest: {station.name}</span>
            <span className="ml-auto text-[13px] text-gray-600 dark:text-night-text/70">
              {state.m < 1000 ? `${Math.round(state.m / 10) * 10} m` : `${(state.m / 1000).toFixed(1)} km`} ·{' '}
              {Math.max(1, Math.round(state.m / 80))} min walk
            </span>
          </Link>
          <NearestLines station={station} nowMs={nowMs} mode={mode} />
        </>
      ) : (
        <div className="flex items-center gap-3">
          <Icon name="pin" size={18} className="text-aqua-text" />
          <span className="flex-1 text-sm">
            {state === 'denied'
              ? 'Location is off. Search for a station instead.'
              : 'Find your nearest station and its next trains.'}
          </span>
          <SecondaryButton className="min-h-10 px-3 text-sm" onClick={ask} disabled={state === 'asking'}>
            {state === 'asking' ? 'Locating…' : 'Use my location'}
          </SecondaryButton>
        </div>
      )}
    </section>
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { mode, renderedAt } = loaderData
  const nowMs = useNow(renderedAt, 1000)
  const page = usePageCheck()
  const fetcher = useFetcher(mode)
  // Server-rendered favourites first (cookie), then the full list from localStorage after mount.
  const [favourites, setFavourites] = useState<Favourite[]>(loaderData.favourites)
  useEffect(() => {
    const list = readFavourites()
    setFavourites(list)
    if (!canPrefetch() || list.length === 0) return
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500))
    idle(() => {
      prefetchFavourites(fetcher, list).catch(() => {})
    })
  }, [fetcher])

  return (
    <Shell
      active="home"
      // From the loader data until the cards report (useReportLive).
      live={Object.values(loaderData.boards).every((r) => !r || boardState(r, false, nowMs, page) == null)}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3.5">
        <h1 className="text-xl font-extrabold">Your trips</h1>
        {favourites.length ? (
          favourites.map((f, i) => (
            <FavouriteCard
              key={favouriteId(f)}
              fav={f}
              initial={loaderData.boards[favouriteId(f)] ?? null}
              nowMs={nowMs}
              mode={mode}
              primary={i === 0}
            />
          ))
        ) : (
          <div className="rounded-card bg-white/90 px-4 py-5 shadow-card dark:bg-night-card">
            <p className="font-semibold">No saved trips yet</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-night-text/80">
              Open a station, choose where you're going and tap the star. Saved trips show here and work
              offline for the rest of the day.
            </p>
            <Link
              to={at('/stations')}
              className="mt-3 inline-flex min-h-11 items-center rounded-button bg-ferry-orange-aa px-4 font-bold text-white no-underline"
            >
              Find a station
            </Link>
          </div>
        )}
        <Nearest nowMs={nowMs} mode={mode} />
        <section aria-labelledby="popular">
          <h2 id="popular" className={SECTION.h2}>
            Popular stations
          </h2>
          <ul className={SECTION.list}>
            {POPULAR.map((k) => stationByKey(k))
              .filter((s): s is Station => !!s)
              .map((s) => (
                <li key={s.key}>
                  <Link className={SECTION.link} to={stationHref(s.key)}>
                    {s.name}
                  </Link>
                </li>
              ))}
            <li>
              <Link className={SECTION.link} to={at('/stations')}>
                All {STATIONS.length} stations
              </Link>
            </li>
          </ul>
        </section>
        <section className="mt-2" aria-labelledby="about">
          <h2 id="about" className={SECTION.heading}>
            Brisbane train times: live departures and platforms
          </h2>
          <p className={SECTION.text}>
            Live departure boards for every Queensland Rail City network station in South East Queensland,
            with the platform for each train, platform changes as they happen, stopping patterns that show
            which stations an express runs through, and line status from Translink.
          </p>
        </section>
      </div>
    </Shell>
  )
}
