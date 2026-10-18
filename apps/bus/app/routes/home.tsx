/**
 * / (B-Home, B-Desktop): "My stops" cards with each saved stop's next 3 buses, and the search-first stop finder.
 * Saved stops travel in a cookie (first 3) so their rows are in the server HTML. Desktop shows full boards side by
 * side.
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { formatClock, Icon, type MiniDeparture, MyStopCard, minutesUntil } from '@bft/ui'
import { Link } from 'react-router'
import { SearchPanel } from '../components/SearchPanel.tsx'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { DepartureList, linkRenderer } from '../components/StopBoard.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { useApi } from '../lib/mode.ts'
import { useAlerts, useManyDepartures } from '../lib/queries.ts'
import { HOME_META, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { stopMeta, stopPath } from '../lib/stops.ts'
import { type SavedStop, savedFromCookie, useSavedStops } from '../lib/storage.ts'
import { useNow } from '../lib/useNow.ts'
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
  return { serverSaved, initial, renderedAt: Date.now(), siteUrl: env?.SITE_URL ?? SITE_URL }
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
  const first = queries.find((q) => q.data)?.data
  const refetchAll = () => {
    for (const q of queries) q.refetch()
  }
  const activeAlerts = (alertsQ.data?.alerts ?? []).length
  return (
    <>
      <SiteHeader live={first ? first.rtState === 'live' : true} />
      <UpdatedStrip
        updatedAt={first?.generatedAt ?? null}
        sourceS={first?.rtSourceTimestamp ?? null}
        nowMs={now}
        onRefresh={ids.length ? refetchAll : undefined}
        refreshing={queries.some((q) => q.isFetching)}
      >
        <DesktopNav active="home" />
      </UpdatedStrip>
      <SearchPanel
        quick={
          <Link to="/nearby" className={chip}>
            <Icon name="nearby" size={16} />
            Near me
          </Link>
        }
      >
        <main className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-3.5 pb-64 md:pb-6">
          <h1 className="text-xl font-extrabold md:sr-only">My stops</h1>
          {first ? <DataBanner rtState={first.rtState} hasData generation={first.staticGeneration} /> : null}
          {saved.length === 0 ? (
            <FirstVisit />
          ) : (
            <>
              {/* Phones: compact cards with the next 3 buses. */}
              <div className="flex flex-col gap-3 md:hidden">
                {saved.map((s, i) => {
                  const res = queries[i]?.data
                  const name = s.name || res?.stop.name || `Stop ${s.id}`
                  return (
                    <MyStopCard
                      key={s.id}
                      name={name}
                      meta={stopMeta(s.id)}
                      href={stopPath(s.id)}
                      departures={miniRows(res, now)}
                      highlighted={i === 0}
                      renderLink={linkRenderer}
                      empty={
                        queries[i]?.isError
                          ? "Couldn't load live times. Retrying…"
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
                  const res = q?.data
                  return (
                    <section
                      key={s.id}
                      className="flex min-w-0 flex-[1_1_420px] flex-col gap-3"
                      aria-label={s.name || res?.stop.name}
                    >
                      <div className="bg-board-header flex items-center justify-between gap-2 rounded-card border border-ferry-orange/10 px-4 py-3 shadow-sm">
                        <h2 className="text-[17px] font-bold text-aqua-text dark:text-ferry-aqua-light">
                          <Link to={stopPath(s.id)}>{s.name || res?.stop.name || `Stop ${s.id}`}</Link>
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
                      />
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </main>
        <Footer />
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
            <Link to={stopPath(s.id)} className={chip}>
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
