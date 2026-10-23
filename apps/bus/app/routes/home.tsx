/**
 * Bus home (THE-118 PR 8, the mode-home skeleton): the title and the stop search (search-first, as before), Saved
 * (saved stops as My Transit cards with each one's next buses; the first 3 travel in a cookie so their rows are in
 * the server HTML), Near you (once the device's position is known), busy stops as chips, and the SEO copy closed
 * under "About bus times".
 */

import type { DeparturesResponse } from '@bft/core/contract'
import { Icon, SavedTripCard, useGeolocation } from '@bft/ui'
import { asSeed, awaitingSeedAnswer, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import {
  AboutTimes,
  HomeSection,
  homeCard,
  LiveReports,
  PlaceChips,
  pageLive,
  reportValue,
  SavedEmpty,
  showsLive,
  UseLocationRow,
  useLiveReports,
  useReportLive,
} from '@bft/ui/mode-home'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router'
import { SearchPanel } from '../components/SearchPanel.tsx'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { linkRenderer } from '../components/StopBoard.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { useApi } from '../lib/mode.ts'
import { liveView, useAlerts, useManyDepartures } from '../lib/queries.ts'
import { HOME_META, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { stopHref } from '../lib/stops.ts'
import { type SavedStop, savedFromCookie, useSavedStops } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/home'

// Only once the position is known.
const NearYou = lazy(() => import('../components/NearYou.tsx'))

/** Suggestions for a first visit (busiest busway platforms and city stops). */
export const POPULAR: SavedStop[] = [
  { id: '10802', name: 'Cultural Centre station, platform 1' },
  { id: '10780', name: 'King George Square, 2a' },
  { id: '19051', name: 'Mater Hill station, platform 1' },
  { id: '37', name: 'Adelaide Street Stop 37 near Anzac Square' },
]

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fetcher, env } = loaderEnv(request, context)
  const ids = savedFromCookie(request.headers.get('cookie'))
  const results = await Promise.all(
    ids.map((id) =>
      settle((signal) => fetchDepartures(fetcher, id, { signal, validate: validateDepartures })),
    ),
  )
  const initial: Record<string, DeparturesResponse | null> = {}
  ids.forEach((id, i) => {
    initial[id] = results[i] ?? null
  })
  const serverSaved: SavedStop[] = ids.map((id) => ({ id, name: initial[id]?.stop.name ?? '' }))
  return {
    serverSaved,
    initial,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const siteUrl = loaderData?.siteUrl ?? SITE_URL
  return pageMeta({ ...HOME_META, url: `${siteUrl}/`, siteUrl })
}

const chip =
  'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-[13px] font-semibold whitespace-nowrap text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light'

/** One saved stop as a My Transit card (its query is the home's), reported to the header like a board. */
function StopCard({
  stop,
  q,
  nowMs,
}: {
  stop: SavedStop
  q: ReturnType<typeof useManyDepartures>[number]
  nowMs: number
}) {
  const online = useOnline()
  const { data, state } = liveView(stop.id, q.data, nowMs, online, usePageCheck())
  const card = homeCard('bus', data, nowMs, stop.name || data?.stop.name || `Stop ${stop.id}`, stop.id)
  // No data is never live; a non-live seed whose own refetch is still out waits (R32-RT1). LIVE only over a live row
  // it shows (R36-L1).
  useReportLive(
    `stop:${stop.id}`,
    state == null && q.data != null && q.data.rtState === 'live',
    (!q.data && !q.isError) || awaitingSeedAnswer(q, state),
    q.isError || q.failureCount > 0,
    card.liveRows,
  )
  return (
    <SavedTripCard
      mode="bus"
      label={card.label}
      title={card.title}
      live={card.live}
      time={card.time}
      detail={card.detail}
      minutes={card.minutes}
      later={card.later}
      empty={
        q.isError && !q.data
          ? "Couldn't load live times. Retrying…"
          : !data
            ? 'Getting live buses…'
            : card.time
              ? null
              : state === 'offline'
                ? 'Offline: no more times in the saved timetable.'
                : 'No buses due.'
      }
      loading={!data && !q.isError}
      href={stopHref(stop.id)}
      renderLink={linkRenderer}
    />
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { mode, fetcher } = useApi()
  const saved = useSavedStops(loaderData.serverSaved)
  const ids = saved.map((s) => s.id)
  const queries = useManyDepartures(fetcher, mode, ids, loaderData.initial)
  const alertsQ = useAlerts(fetcher, mode)
  const now = useNow(loaderData.renderedAt)
  const online = useOnline()
  // Timetable only unless the data is live and fresh (offline, cached copy, stale).
  const page = usePageCheck()
  const views = queries.map((q, i) => liveView(ids[i] as string, q.data, now, online, page))
  const first = views.find((v) => v.data)?.data
  const refetchAll = () => {
    for (const q of queries) q.refetch()
  }
  const activeAlerts = (alertsQ.data?.alerts ?? []).length
  // Until the cards report (after hydration): the server's saved stops. LIVE only while every one is live (each
  // confirms itself after a cached page, R2-T7); one still waiting is not live (R7-T1) but "Connecting…" while nothing
  // has failed (R32-RT1). No saved stops and no position: no live rows, so the header claims nothing (#159).
  // Only the stops still saved: one taken out since (here or in another tab) claims nothing (Codex r1).
  const seeds = ids.filter((id) => id in loaderData.initial).map((id) => loaderData.initial[id] ?? null)
  const seedState = (r: DeparturesResponse) => liveView('', r, now, true, page).state
  const reports = useLiveReports({
    // Live data with no live row shown claims nothing (R36-L1).
    live: seeds.length
      ? pageLive(
          seeds.map((r) =>
            reportValue(
              !!r && seedState(r) == null && r.rtState === 'live',
              false,
              false,
              !!r && showsLive(liveView('', r, now, true, page).data),
            ),
          ),
        ).live
      : undefined,
    pending: seeds.some((r) => !r || awaitingSeedAnswer(asSeed(r), seedState(r))),
  })
  const { geo, locate } = useGeolocation()
  return (
    <LiveReports value={reports.report}>
      <SiteHeader live={reports.live} pending={reports.pending} />
      <UpdatedStrip
        updatedAt={first?.generatedAt ?? null}
        source={first}
        nowMs={now}
        onRefresh={ids.length ? refetchAll : undefined}
        refreshing={queries.some((q) => q.isFetching)}
        live={reports.live}
        pending={reports.pending}
      >
        <DesktopNav active="home" />
      </UpdatedStrip>
      <h1 className="mx-auto max-w-6xl px-4 pt-4 text-[28px] leading-tight font-extrabold">Bus</h1>
      <SearchPanel
        quick={
          <Link to={at('/nearby')} className={chip}>
            <Icon name="nearby" size={16} />
            Near me
          </Link>
        }
      >
        <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-3.5 pb-6">
          {first ? (
            <DataBanner
              offline={views.some((v) => v.state === 'offline')}
              rtState={reports.pending ? undefined : first.rtState}
              hasData
              generation={first.staticGeneration}
            />
          ) : null}
          <HomeSection id="saved" title="Saved">
            {saved.length ? (
              saved.map((s, i) => (
                <StopCard key={s.id} stop={s} q={queries[i] as (typeof queries)[number]} nowMs={now} />
              ))
            ) : (
              <SavedEmpty />
            )}
          </HomeSection>
          <HomeSection id="near" title="Near you">
            {geo.state === 'ok' ? (
              <Suspense fallback={null}>
                <NearYou lat={geo.lat} lon={geo.lon} nowMs={now} />
              </Suspense>
            ) : (
              <UseLocationRow state={geo.state} onLocate={locate} what="stops" />
            )}
          </HomeSection>
          <HomeSection id="popular" title="Busy stops">
            <PlaceChips
              places={POPULAR.map((s) => ({ href: stopHref(s.id), name: s.name }))}
              renderLink={linkRenderer}
            />
          </HomeSection>
          <AboutTimes title="About bus times">
            <h2 className="text-base font-bold text-aqua-text dark:text-ferry-aqua-light">
              Live departures for every Brisbane bus stop
            </h2>
            <p className="mt-2 text-sm text-gray-700 dark:text-night-text/80">
              Search by stop name or number, or find stops near you. Tap the star on a stop to keep it here
              with its next buses.
            </p>
          </AboutTimes>
        </main>
        {/* The footer, not the content, clears the fixed sheet: it comes last. */}
        <Footer aboveSheet />
      </SearchPanel>
      <BusNav active="home" alertCount={activeAlerts || undefined} />
    </LiveReports>
  )
}
