/**
 * /alerts (X-Alerts): every mode's service alerts in one list, filtered by mode chips ("Affects my trips", All,
 * Ferry n, Train n, Bus n). The server renders the list (one /v1/alerts call for all modes); the client polls every
 * minute and works out which alerts touch saved stops, which only this device knows.
 */
import type { AlertsResponse } from '@bft/core/contract'
import { ChipFilter, type ChipOption, EmptyState, ErrorState, ModeAlertCard, type TransitMode } from '@bft/ui'
import { useEffect, useMemo, useState } from 'react'
import { TransitFooter, TransitHeader, TransitStrip } from '../components/Chrome.tsx'
import {
  ALERT_MODES,
  alertMode,
  impactOn,
  inMode,
  type SavedScope,
  savedScope,
  scopeText,
  severityOf,
  sortAlerts,
  whenText,
} from '../lib/alerts.ts'
import { fetchAlerts } from '../lib/api.ts'
import { validateAlerts } from '../lib/contract.server.ts'
import { useAlerts, useApi } from '../lib/queries.ts'
import { readSavedItems } from '../lib/saved.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { useNow } from '../lib/useNow.ts'
import type { Route } from './+types/alerts'

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fetcher } = loaderEnv(request, context)
  const alerts: AlertsResponse | null = await settle((signal) =>
    fetchAlerts(fetcher, { signal, validate: validateAlerts }),
  )
  // Name the train lines of the alerts in the HTML here, so the browser needn't load the train network to show them.
  const { trainLinesOf } = await import('../lib/train-lines.ts')
  const scopes = Object.fromEntries((alerts?.alerts ?? []).map((a) => [a.id, scopeText(a, trainLinesOf)]))
  return { alerts, scopes, renderedAt: Date.now() }
}

export const meta: Route.MetaFunction = () => [
  { title: 'Service alerts: ferry, train and bus | BrisbaneTransit' },
  { name: 'robots', content: 'noindex' },
]

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

type Filter = 'mine' | 'all' | TransitMode

const LABEL: Record<TransitMode, string> = { ferry: 'Ferry', train: 'Train', bus: 'Bus' }

export default function Alerts({ loaderData }: Route.ComponentProps) {
  const { mode, fetcher } = useApi()
  const q = useAlerts(fetcher, mode, loaderData.alerts)
  const now = useNow(loaderData.renderedAt, 60_000)
  const nowS = Math.floor(now / 1000)
  const [scope, setScope] = useState<SavedScope | null>(null)
  const [train, setTrain] = useState<typeof import('../lib/train-lines.ts') | null>(null)
  useEffect(() => {
    const items = readSavedItems()
    setScope(savedScope(items))
    // The train network loads only if needed: saved train stations to match, or alerts the server didn't name.
    const unnamed = (q.data?.alerts ?? []).some(
      (a) => alertMode(a) === 'train' && !(a.id in loaderData.scopes),
    )
    if (items.some((i) => i.mode === 'train') || unnamed)
      void import('../lib/train-lines.ts').then((m) => {
        setTrain(m)
        setScope(savedScope(items, m.platformsOf))
      })
  }, [q.data, loaderData.scopes])
  const [filter, setFilter] = useState<Filter>('all')
  const all = useMemo(() => sortAlerts(q.data?.alerts ?? [], nowS), [q.data, nowS])
  const mine = scope ? all.filter((a) => impactOn(a, scope)) : []
  const shown = filter === 'all' ? all : filter === 'mine' ? mine : all.filter((a) => inMode(a, filter))
  const options: ChipOption<Filter>[] = [
    ...(mine.length ? [{ value: 'mine' as const, label: 'Affects my trips', count: mine.length }] : []),
    { value: 'all', label: 'All' },
    ...ALERT_MODES.map((m) => ({ value: m, label: LABEL[m], count: all.filter((a) => inMode(a, m)).length })),
  ]
  return (
    <>
      <TransitHeader live={q.data?.rtState === 'live'} />
      <TransitStrip updatedAt={q.data?.generatedAt ?? null} />
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-3.5 pt-3.5 pb-4 md:px-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-[22px] font-extrabold">Service alerts</h1>
          <span className="text-sm text-sched-text">{all.length} active</span>
        </div>
        <ChipFilter<Filter> label="Filter alerts" value={filter} onChange={setFilter} options={options} />
        {q.isError && !q.data ? (
          <ErrorState title="Alerts aren't loading" onRetry={() => q.refetch()}>
            Translink's live feed didn't answer. Try again in a moment.
          </ErrorState>
        ) : shown.length === 0 ? (
          <EmptyState title={filter === 'all' ? 'No alerts right now' : 'No alerts here'}>
            Services are running as timetabled.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {shown.map((a) => (
              <li key={a.id}>
                <ModeAlertCard
                  mode={alertMode(a)}
                  scope={loaderData.scopes[a.id] ?? scopeText(a, train?.trainLinesOf)}
                  severity={severityOf(a, nowS)}
                  title={a.header}
                  body={[a.summary ?? a.description, whenText(a, nowS)].filter(Boolean).join(' · ')}
                  impact={scope ? impactOn(a, scope) : null}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
      <TransitFooter />
    </>
  )
}
