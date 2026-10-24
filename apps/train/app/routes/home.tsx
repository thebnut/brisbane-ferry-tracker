/**
 * Train home (THE-118 PR 8, the mode-home skeleton): the title with "Find a station" and Map, Saved (favourites as My
 * Transit cards; the first few server-rendered from the bft_fav cookie), Near you (once the device's position is
 * known), popular stations with "All N stations", and the SEO copy closed under "About train times". Favourites'
 * full-day timetables are saved for offline use in the background.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import { Icon, SavedTripCard, useGeolocation } from '@bft/ui'
import { asSeed, awaitingSeedAnswer, type PageCheck, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import {
  AboutTimes,
  CHIP,
  HomeSection,
  HomeTitle,
  homeCard,
  PlaceChips,
  pageLive,
  reportValue,
  SavedEmpty,
  SearchPlaceholder,
  showsLive,
  UseLocationRow,
} from '@bft/ui/mode-home'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { SECTION, Shell, useReportLive } from '../components/Chrome.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { boardState, visibleRows } from '../lib/departures.ts'
import { boardHref, STATIONS, type Station, stationByKey, stationHref } from '../lib/network.ts'
import { canPrefetch, prefetchFavourites } from '../lib/offline.ts'
import { type DataMode, useDepartures, useFetcher } from '../lib/queries.ts'
import { HOME_META, homeJsonLd, pageMeta } from '../lib/seo.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
import { type Favourite, favouriteId, favouritesFromCookie, readFavourites } from '../lib/storage.ts'
import { useMounted, useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/home'

// "Find a station" (THE-118 PR 3): client-only (Ark UI), loaded after hydration.
const StationSearch = lazy(() =>
  import.meta.env.SSR ? new Promise<never>(() => {}) : import('../components/StationSearch.tsx'),
)
// Only once the position is known.
const NearYou = lazy(() => import('../components/NearYou.tsx'))

const Search = () => <SearchPlaceholder label="Find a station" placeholder="Station name" />

/** The search and a Map chip, where the section bar's Stations and Map went (THE-118 PR 3). */
function ModeHomeTop() {
  const mounted = useMounted()
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        {mounted ? (
          <Suspense fallback={<Search />}>
            <StationSearch />
          </Suspense>
        ) : (
          <Search />
        )}
      </div>
      <Link
        to={at('/map')}
        prefetch="intent"
        className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border-2 border-ferry-orange/30 bg-white px-3.5 text-sm font-bold text-aqua-text no-underline dark:bg-night-card dark:text-ferry-aqua-light"
      >
        <Icon name="map" size={18} />
        Map
      </Link>
    </div>
  )
}

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
    via: VIA_NETWORK,
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

const linkTo = ({ href, className, children }: { href: string; className: string; children: ReactNode }) => (
  <Link to={href} className={className} prefetch="intent">
    {children}
  </Link>
)

const bare = (s: Station | null) => s?.name.replace(/ station$/, '') ?? ''

/** The server's boards as the cards will report them (a missing one waits); undefined: only timetabled trains. */
const seedsLive = (seeds: (DeparturesResponse | null)[], nowMs: number, page: PageCheck | null) =>
  pageLive(
    seeds.map((r) => {
      if (!r) return reportValue(false, true, false, false)
      const state = boardState(r, false, nowMs, page)
      return reportValue(
        state == null,
        false,
        false,
        showsLive({ ...r, departures: visibleRows(r.departures, state, nowMs) }),
      )
    }),
  ).live

/** One saved trip as a My Transit card: its next trains, timetable only unless live, reported to the header. */
function FavouriteCard({
  fav,
  initial,
  nowMs,
  mode,
}: {
  fav: Favourite
  initial: DeparturesResponse | null
  nowMs: number
  mode: DataMode
}) {
  const fetcher = useFetcher(mode)
  const q = useDepartures(fetcher, mode, fav.from, fav.to, initial, 4)
  const online = useOnline()
  const page = usePageCheck()
  const state = boardState(
    q.data,
    !online || (q.data as { offline?: boolean } | undefined)?.offline === true,
    nowMs,
    page,
  )
  const from = stationByKey(fav.from)
  const to = stationByKey(fav.to)
  const card = homeCard(
    'train',
    q.data && { ...q.data, departures: visibleRows(q.data.departures, state, nowMs) },
    nowMs,
    to ? `${bare(from)} → ${bare(to)}` : bare(from),
    fav.from,
  )
  // The header pill is LIVE only while no card is stale and one shows a live train (R36-L1). No data is never live (a
  // first request that failed with an HTTP error leaves the state null). A non-live seed whose own refetch is still
  // out waits too (R32-RT1).
  useReportLive(
    `fav:${fav.from}>${fav.to ?? ''}`,
    state == null && q.data != null,
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
    card.liveRows,
  )
  return (
    <div data-testid="favourite">
      <SavedTripCard
        mode="train"
        label={card.label}
        title={card.title}
        live={card.live}
        time={card.time}
        detail={card.detail}
        minutes={card.minutes}
        later={card.later}
        empty={
          q.isPending
            ? 'Getting live departures…'
            : q.isError && !q.data
              ? "Live times aren't loading. Open the board for the timetable."
              : card.time
                ? null
                : 'No more trains today.'
        }
        loading={q.isPending}
        href={boardHref(fav.from, fav.to)}
        renderLink={linkTo}
      />
    </div>
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
  const { geo, locate } = useGeolocation()
  // The server's boards of the trips still saved: one taken out since claims nothing (Codex r1).
  const seeds = favourites
    .map((f) => favouriteId(f))
    .filter((id) => id in loaderData.boards)
    .map((id) => loaderData.boards[id] ?? null)

  return (
    <Shell
      active="home"
      // From the loader data until the cards report (useReportLive); no boards, no live data of its own.
      // Live data with no live train shown claims nothing (R36-L1).
      live={seeds.length ? seedsLive(seeds, nowMs, page) : undefined}
      // A board the server couldn't load has no answer yet: BrisbaneTransit says "Connecting…", not LIVE (THE-118).
      // So does one with a non-live seed until its card's own answer (R32-RT1).
      pending={seeds.some((r) => !r || awaitingSeedAnswer(asSeed(r), boardState(r, false, nowMs, page)))}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <HomeTitle title="Train">
          <ModeHomeTop />
        </HomeTitle>
        <HomeSection id="saved" title="Saved">
          {favourites.length ? (
            favourites.map((f) => (
              <FavouriteCard
                key={favouriteId(f)}
                fav={f}
                initial={loaderData.boards[favouriteId(f)] ?? null}
                nowMs={nowMs}
                mode={mode}
              />
            ))
          ) : (
            <SavedEmpty />
          )}
        </HomeSection>
        <HomeSection id="near" title="Near you">
          {geo.state === 'ok' ? (
            <Suspense fallback={null}>
              <NearYou lat={geo.lat} lon={geo.lon} nowMs={nowMs} mode={mode} />
            </Suspense>
          ) : (
            <UseLocationRow state={geo.state} onLocate={locate} what="stations" />
          )}
        </HomeSection>
        <HomeSection id="popular" title="Popular stations">
          <PlaceChips
            places={POPULAR.map((k) => stationByKey(k))
              .filter((s): s is Station => !!s)
              .map((s) => ({ href: stationHref(s.key), name: s.name }))}
            renderLink={linkTo}
          >
            <li>
              <Link className={CHIP} to={at('/stations')}>
                All {STATIONS.length} stations
              </Link>
            </li>
          </PlaceChips>
        </HomeSection>
        <AboutTimes title="About train times">
          <h2 className={SECTION.heading}>Brisbane train times: live departures and platforms</h2>
          <p className={SECTION.text}>
            Live departure boards for every Queensland Rail City network station in South East Queensland,
            with the platform for each train, platform changes as they happen, stopping patterns that show
            which stations an express runs through, and line status from Translink.
          </p>
        </AboutTimes>
      </div>
    </Shell>
  )
}
