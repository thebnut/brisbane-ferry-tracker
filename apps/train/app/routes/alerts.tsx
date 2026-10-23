/**
 * /alerts: service alerts and line status (T-Alerts) from /v1/alerts?mode=train. "My trips" shows the alerts that
 * touch a favourite's lines (or stations) first; "All lines" shows every line's status.
 */

import type { Alert } from '@bft/core/contract'
import { AlertCard, ErrorState, FilterPills, formatWhen, Icon, LineStatus } from '@bft/ui'
import { liveState, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { useEffect, useMemo, useState } from 'react'
import { SECTION, Shell } from '../components/Chrome.tsx'
import {
  currentEnd,
  isActive,
  isNetworkWide,
  lineStatus,
  linesOfAlert,
  networkNotices,
  nextStart,
  upcomingAlerts,
} from '../lib/alerts.ts'
import { fetchAlerts } from '../lib/api.ts'
import { validateAlerts } from '../lib/contract.server.ts'
import { reachableFrom, stationByKey } from '../lib/network.ts'
import { useAlerts, useFetcher } from '../lib/queries.ts'
import { pageMeta } from '../lib/seo.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
import { type Favourite, readFavourites } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/alerts'

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
  const alerts = await settle((signal) => fetchAlerts(fetcher, { signal, validate: validateAlerts }))
  return { alerts, renderedAt: Date.now(), via: VIA_NETWORK, mode: { fixtures, rt }, site: siteInfo(env) }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const site = loaderData?.site ?? { siteUrl: '', indexable: false }
  return pageMeta({
    title: 'Train line status and service alerts | BrisbaneTrain',
    description:
      'Live status for every South East Queensland train line: delays, platform changes and track works.',
    url: `${site.siteUrl}/alerts`,
    site,
  })
}

/** Lines and stations a favourite uses. */
function favouriteScope(favs: Favourite[]) {
  const lines = new Set<string>()
  const stations = new Set<string>()
  for (const f of favs) {
    stations.add(f.from)
    if (f.to) stations.add(f.to)
    for (const g of reachableFrom(f.from))
      if (!f.to || g.stations.some((s) => s.key === f.to)) lines.add(g.line.name)
  }
  return { lines, stations }
}

/** "Until Sun 25 Oct, 10:59 pm" for an active alert, "From Sat 24 Oct, 3:00 am" for an upcoming one. */
const when = (a: Alert, nowS: number) => {
  const start = nextStart(a, nowS)
  if (start != null) return `From ${formatWhen(start, nowS * 1000)}`
  const end = currentEnd(a, nowS)
  return end != null ? `Until ${formatWhen(end, nowS * 1000)}` : null
}

const severityOf = (a: Alert) =>
  a.severity === 'SEVERE' ? 'severe' : a.severity === 'INFO' ? 'info' : ('warning' as const)

export default function Alerts({ loaderData }: Route.ComponentProps) {
  const { mode, renderedAt } = loaderData
  const fetcher = useFetcher(mode)
  const q = useAlerts(fetcher, mode, loaderData.alerts)
  const nowMs = useNow(renderedAt, 30_000)
  const nowS = Math.floor(nowMs / 1000)
  // The header claims LIVE only from the alerts' own fresh answer (shared liveState); none yet: "Connecting…".
  const state = liveState(q.data, { offline: !useOnline(), nowMs, ...usePageCheck() })
  const [favs, setFavs] = useState<Favourite[]>([])
  useEffect(() => setFavs(readFavourites()), [])
  const [view, setView] = useState<'mine' | 'all'>('all')
  useEffect(() => setView(favs.length ? 'mine' : 'all'), [favs.length])

  // Network-wide notices show once at the top; upcoming alerts never mark today's lines (T3).
  const network = useMemo(() => networkNotices(q.data?.alerts ?? [], nowS), [q.data, nowS])
  const alerts = useMemo(
    () => (q.data?.alerts ?? []).filter((a) => isActive(a, nowS) && !isNetworkWide(a)),
    [q.data, nowS],
  )
  const upcoming = useMemo(() => upcomingAlerts(q.data?.alerts ?? [], nowS), [q.data, nowS])
  const scope = useMemo(() => favouriteScope(favs), [favs])
  const affectsMe = (a: Alert) =>
    linesOfAlert(a).some((l) => scope.lines.has(l)) ||
    a.stops.some((id) => [...scope.stations].some((k) => stationByKey(k)?.platforms.some((p) => p.id === id)))
  const mine = alerts.filter(affectsMe)
  const rows = lineStatus(alerts, nowS)
  const shownRows = view === 'mine' && scope.lines.size ? rows.filter((r) => scope.lines.has(r.name)) : rows
  const others =
    view === 'mine' ? alerts.filter((a) => !affectsMe(a)) : alerts.filter((a) => !mine.includes(a))

  return (
    <Shell active="alerts" live={q.data != null && state == null} pending={!q.data && !q.isError}>
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold">Service alerts</h1>
          <FilterPills
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'mine', label: 'My trips' },
              { value: 'all', label: 'All lines' },
            ]}
          />
        </div>
        {q.isError && !q.data ? (
          <ErrorState onRetry={() => q.refetch()}>Alerts didn't load.</ErrorState>
        ) : null}
        {network.map((a) => (
          <AlertCard
            key={a.id}
            title={a.header}
            severity={severityOf(a)}
            meta={['All lines', when(a, nowS)].filter(Boolean).join(' · ')}
          >
            {a.description}
          </AlertCard>
        ))}
        {mine.map((a) => (
          <article
            key={a.id}
            data-testid="my-alert"
            className="bg-hot flex flex-col gap-1.5 rounded-card border-2 border-ferry-orange p-3.5"
          >
            <span className="flex items-center gap-2 text-xs font-extrabold tracking-[0.04em] text-ferry-orange-aa">
              <Icon name="alert" size={20} />
              AFFECTS YOUR TRIP · NOW
            </span>
            <h2 className="text-base font-bold">{a.header}</h2>
            {a.description ? (
              <p className="text-[13px] leading-snug text-gray-700 dark:text-night-text/80">
                {a.description}
              </p>
            ) : null}
          </article>
        ))}
        {view === 'mine' && favs.length === 0 ? (
          <p className="text-sm text-sched-text">
            Save a trip with the star on a station board to see the alerts that affect it here.
          </p>
        ) : null}
        <h2 className={`${SECTION.h2} mt-1`}>Line status</h2>
        <LineStatus lines={shownRows} />
        {others.length ? (
          <>
            <h2 className={`${SECTION.h2} mt-2`}>{view === 'mine' ? 'Other alerts' : 'All alerts'}</h2>
            {others.map((a) => (
              <AlertCard
                key={a.id}
                title={a.header}
                severity={severityOf(a)}
                meta={[linesOfAlert(a).join(', '), when(a, nowS)].filter(Boolean).join(' · ') || undefined}
              >
                {a.description}
              </AlertCard>
            ))}
          </>
        ) : null}
        {upcoming.length ? (
          <>
            <h2 className={`${SECTION.h2} mt-2`}>Upcoming</h2>
            {upcoming.map((a) => (
              <div key={a.id} data-testid="upcoming-alert">
                <AlertCard
                  title={a.header}
                  severity="info"
                  meta={
                    [isNetworkWide(a) ? 'All lines' : linesOfAlert(a).join(', '), when(a, nowS)]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                >
                  {a.description}
                </AlertCard>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </Shell>
  )
}
