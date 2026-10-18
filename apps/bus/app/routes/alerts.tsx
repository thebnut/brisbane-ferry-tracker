/**
 * /alerts (B-Alerts): detours, changed stops, planned changes and notices for bus, scoped to your saved stops (and
 * the routes serving them) or all routes. Server-rendered from /v1/alerts?mode=bus.
 */
import type { Alert } from '@bft/core/contract'
import { cx, RouteTile, routeTileVariant, SegmentedControl } from '@bft/ui'
import { useEffect, useMemo, useState } from 'react'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { alertKind, forMyStops, KIND_LABEL, sortAlerts, whenText } from '../lib/alerts.ts'
import { fetchAlerts } from '../lib/api.ts'
import { validateAlerts } from '../lib/contract.server.ts'
import { isActive } from '../lib/departures.ts'
import { useApi } from '../lib/mode.ts'
import { useAlerts, useStopIndex } from '../lib/queries.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { routeShortOf } from '../lib/stops.ts'
import { useSavedStops } from '../lib/storage.ts'
import { useNow } from '../lib/useNow.ts'
import type { Route } from './+types/alerts'

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fetcher } = loaderEnv(request, context)
  const alerts = await settle((signal) => fetchAlerts(fetcher, { signal, validate: validateAlerts }))
  return { alerts, renderedAt: Date.now() }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: 'Brisbane bus detours and service alerts | BrisbaneBus',
    description:
      'Current bus detours, stop changes and planned service changes across Brisbane and South East Queensland.',
    url: `${SITE_URL}/alerts`,
  })

const SEV: Record<string, string> = {
  detour: 'bg-ferry-orange-aa text-white',
  changed: 'bg-ferry-orange-light text-orange-800',
  planned: 'bg-sched-bg text-gray-700',
  info: 'bg-ferry-light-blue text-[#00546B]',
}

function AlertItem({ a, nowS, hot }: { a: Alert; nowS: number; hot: boolean }) {
  const kind = alertKind(a, nowS)
  const routes = [...new Set(a.routes.map(routeShortOf))]
  return (
    <article
      data-alert={kind}
      className={cx(
        'flex flex-col gap-2 rounded-card px-3.5 py-3',
        hot
          ? 'bg-hot border-2 border-ferry-orange shadow-[0_0_18px_rgb(255_107_53/0.3)]'
          : 'bg-white/90 shadow-card dark:bg-night-card',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide', SEV[kind])}
        >
          {KIND_LABEL[kind](isActive(a, nowS))}
        </span>
        <span className="text-xs text-sched-text">{whenText(a, nowS)}</span>
      </div>
      <div className="flex items-start gap-2.5">
        {routes.length ? (
          <div className="flex max-w-[92px] shrink-0 flex-wrap gap-1">
            {routes.slice(0, 4).map((r) => (
              <RouteTile
                key={r}
                route={r}
                variant={routeTileVariant(r)}
                size="sm"
                className="h-8 min-w-10 rounded-button text-[15px]"
              />
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-bold">{a.header}</h2>
          {a.summary || a.description ? (
            <p className="text-[13px] leading-snug text-gray-700 dark:text-night-text/80">
              {a.summary ?? a.description}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default function AlertsPage({ loaderData }: Route.ComponentProps) {
  const { mode, fetcher } = useApi()
  const q = useAlerts(fetcher, mode, loaderData.alerts)
  const now = useNow(loaderData.renderedAt)
  const nowS = Math.floor(now / 1000)
  const saved = useSavedStops()
  const [scope, setScope] = useState<'mine' | 'all'>('all')
  // Default to "My stops" once we know there are saved stops (client only).
  useEffect(() => {
    if (saved.length) setScope('mine')
  }, [saved.length])
  const index = useStopIndex(fetcher, mode, saved.length > 0)
  const myRoutes = useMemo(() => {
    const set = new Set<string>()
    for (const s of saved) for (const r of index.byKey.get(s.id)?.routes ?? []) set.add(r)
    return set
  }, [saved, index.byKey])
  const all = sortAlerts(q.data?.alerts ?? [], nowS)
  const mine = forMyStops(
    all,
    saved.map((s) => s.id),
    myRoutes,
  )
  const shown = scope === 'mine' ? mine : all
  return (
    <>
      <SiteHeader live={q.data?.rtState === 'live'} />
      <UpdatedStrip
        updatedAt={q.data?.generatedAt ?? null}
        sourceS={q.data?.rtSourceTimestamp ?? null}
        nowMs={now}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
      >
        <DesktopNav active="alerts" />
      </UpdatedStrip>
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-3.5 pb-28">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold">Service alerts</h1>
          <SegmentedControl
            label="Alert scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'mine', label: 'My stops' },
              { value: 'all', label: 'All routes' },
            ]}
          />
        </div>
        <DataBanner rtState={q.data?.rtState} hasData={!!q.data} generation={q.data?.staticGeneration} />
        {shown.length === 0 ? (
          <p
            className="rounded-card bg-white/90 px-4 py-6 text-center text-sm text-sched-text shadow-card dark:bg-night-card"
            role="status"
          >
            {q.isPending
              ? 'Loading alerts…'
              : q.isError && !q.data
                ? "Couldn't load alerts."
                : scope === 'mine'
                  ? 'No alerts for your saved stops.'
                  : 'No bus alerts right now.'}
          </p>
        ) : (
          shown.map((a, i) => (
            <AlertItem key={a.id} a={a} nowS={nowS} hot={i === 0 && alertKind(a, nowS) === 'detour'} />
          ))
        )}
        {scope === 'mine' ? (
          <p className="text-center text-xs text-sched-text">
            Showing alerts for your {saved.length} saved stop{saved.length === 1 ? '' : 's'} and{' '}
            {myRoutes.size} route{myRoutes.size === 1 ? '' : 's'}
          </p>
        ) : null}
      </main>
      <Footer />
      <BusNav active="alerts" alertCount={mine.length || undefined} />
    </>
  )
}
