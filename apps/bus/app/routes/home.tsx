/**
 * / (B-Home, B-Desktop): "My stops" cards with each saved stop's next 3 buses, and the search-first stop finder.
 * Saved stops travel in a cookie (first 3) so their rows are in the server HTML. Desktop shows full boards side by
 * side.
 */

import type { DeparturesResponse } from '@bft/core/contract'
import { formatClock, Icon, minutesUntil } from '@bft/ui'
import { type MiniDeparture, MyStopCard } from '@bft/ui/bus'
import { usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { Link } from 'react-router'
import { SearchPanel } from '../components/SearchPanel.tsx'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { DepartureList, linkRenderer } from '../components/StopBoard.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { useApi } from '../lib/mode.ts'
import { liveView, useAlerts, useManyDepartures } from '../lib/queries.ts'
import { HOME_META, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { stopHref, stopMeta } from '../lib/stops.ts'
import { type SavedStop, savedFromCookie, useSavedStops } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/home'

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

function miniRows(res: DeparturesResponse | undefined, nowMs: number): MiniDeparture[] {
  if (!res) return []
  return res.departures.slice(0, 3).map((d) => {
    const at = d.estDep ?? d.schedDep
    const delay = d.estDep != null ? Math.round((d.estDep - d.schedDep) / 60) : 0
    const status =
      d.status === 'cancelled'
        ? 'CANCELLED'
        : d.status === 'live'
          ? `LIVE · ${delay >= 1 ? `+${delay} min late` : delay <= -1 ? `${-delay} min early` : 'on time'}`
          : 'SCHEDULED'
    return {
      key: `${d.tripInstance}:${d.stopSequence}`,
      route: d.route.short,
      routeLong: d.route.long,
      destination: d.headsign,
      status,
      live: d.status === 'live',
      minutes: minutesUntil(at, nowMs),
      time: formatClock(at),
    }
  })
}

const chip =
  'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-[13px] font-semibold whitespace-nowrap text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light'

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
  // No saved stops: no live data of its own (the header's default; BrisbaneTransit's claims nothing).
  const live = ids.length
    ? online && views.every((v) => v.data && v.state == null && v.data.rtState === 'live')
    : undefined
  // A saved stop still waiting for its first answer, none failed: BrisbaneTransit's header says "Connecting…" (THE-118).
  const pending = queries.some((q) => !q.data && !q.isError)
  return (
    <>
      {/* LIVE only while every saved stop's board is live (each confirms itself after a cached page, R2-T7). A board
          still waiting for its answer is not live (R7-T1). */}
      <SiteHeader live={live} pending={pending} />
      <UpdatedStrip
        updatedAt={first?.generatedAt ?? null}
        source={first}
        nowMs={now}
        onRefresh={ids.length ? refetchAll : undefined}
        refreshing={queries.some((q) => q.isFetching)}
        live={live}
        pending={pending}
      >
        <DesktopNav active="home" />
      </UpdatedStrip>
      <SearchPanel
        quick={
          <Link to={at('/nearby')} className={chip}>
            <Icon name="nearby" size={16} />
            Near me
          </Link>
        }
      >
        <main className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-3.5 pb-6">
          <h1 className="text-xl font-extrabold md:sr-only">My stops</h1>
          {first ? (
            <DataBanner
              offline={views.some((v) => v.state === 'offline')}
              rtState={first.rtState}
              hasData
              generation={first.staticGeneration}
            />
          ) : null}
          {saved.length === 0 ? (
            <FirstVisit />
          ) : (
            <>
              {/* Phones: compact cards with the next 3 buses. */}
              <div className="flex flex-col gap-3 md:hidden">
                {saved.map((s, i) => {
                  const res = views[i]?.data
                  const name = s.name || res?.stop.name || `Stop ${s.id}`
                  return (
                    <MyStopCard
                      key={s.id}
                      name={name}
                      meta={stopMeta(s.id)}
                      href={stopHref(s.id)}
                      departures={miniRows(res, now)}
                      highlighted={i === 0}
                      renderLink={linkRenderer}
                      empty={
                        queries[i]?.isError
                          ? "Couldn't load live times. Retrying…"
                          : !online && !res?.departures.length
                            ? 'Offline: no more times in the saved timetable.'
                            : res
                              ? 'No buses due.'
                              : 'Getting live buses…'
                      }
                    />
                  )
                })}
              </div>
              {/* Desktop: full boards side by side. */}
              <div className="hidden flex-wrap gap-6 md:flex">
                {saved.map((s, i) => {
                  const q = queries[i]
                  const res = views[i]?.data
                  return (
                    <section
                      key={s.id}
                      className="flex min-w-0 flex-[1_1_420px] flex-col gap-3"
                      aria-label={s.name || res?.stop.name}
                    >
                      <div className="bg-board-header flex items-center justify-between gap-2 rounded-card border border-ferry-orange/10 px-4 py-3 shadow-sm">
                        <h2 className="text-[17px] font-bold text-aqua-text dark:text-ferry-aqua-light">
                          <Link to={stopHref(s.id)}>{s.name || res?.stop.name || `Stop ${s.id}`}</Link>
                        </h2>
                        <span className="text-[13px] text-sched-text">{stopMeta(s.id)}</span>
                      </div>
                      <DepartureList
                        stopId={s.id}
                        data={res}
                        isError={!!q?.isError}
                        onRetry={() => q?.refetch()}
                        nowMs={now}
                        alerts={alertsQ.data?.alerts ?? []}
                        initialCount={5}
                        offline={!online}
                        saved
                      />
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </main>
        {/* The footer, not the content, clears the fixed sheet: it comes last. */}
        <Footer aboveSheet />
      </SearchPanel>
      <BusNav active="home" alertCount={activeAlerts || undefined} />
    </>
  )
}

function FirstVisit() {
  return (
    <section
      className="flex flex-col gap-3 rounded-card bg-white/90 px-4 py-4 shadow-card dark:bg-night-card"
      aria-labelledby="first-visit"
    >
      <h2 id="first-visit" className="text-base font-bold text-aqua-text dark:text-ferry-aqua-light">
        Live departures for every Brisbane bus stop
      </h2>
      <p className="text-sm text-gray-700 dark:text-night-text/80">
        Search by stop name or number, or find stops near you. Tap the star on a stop to keep it here with its
        next three buses.
      </p>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-night-text/80">Busy stops</h3>
      <ul className="flex flex-wrap gap-2">
        {POPULAR.map((s) => (
          <li key={s.id}>
            <Link to={stopHref(s.id)} className={chip}>
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
