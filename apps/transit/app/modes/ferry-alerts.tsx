/**
 * The ferry board's alert count (THE-118 PR 3): the ferry app has no alerts page, so it links to BrisbaneTransit's
 * Alerts with the Ferry chip on, and counts what that chip would. Its own chunk, loaded after hydration (ferry-header.tsx),
 * so the alerts code stays off /ferry's first load.
 */
import { AlertCountLink } from '@bft/ui'
import { Link } from 'react-router'
import { alertModes, inMode, sortAlerts, stopModeOf } from '../lib/alerts.ts'
import { useAlerts, useApi } from '../lib/queries.ts'
import { useNow } from '../lib/useNow.ts'

export const FERRY_ALERTS = '/alerts?mode=ferry'

export default function FerryAlerts() {
  const { mode, fetcher } = useApi()
  const q = useAlerts(fetcher, mode)
  const nowS = Math.floor(useNow(Date.now(), 60_000) / 1000)
  const stopMode = stopModeOf()
  const count = q.data
    ? sortAlerts(q.data.alerts, nowS).filter((a) => inMode(a, 'ferry', alertModes(a, stopMode))).length
    : null
  return <AlertCountLink count={count} href={FERRY_ALERTS} renderLink={link} />
}

function link({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return (
    <Link to={href} prefetch="intent" className={className}>
      {children}
    </Link>
  )
}
