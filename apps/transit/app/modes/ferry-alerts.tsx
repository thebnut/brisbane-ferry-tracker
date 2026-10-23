/**
 * The ferry board's alert count (THE-118 PR 3): the ferry app has no alerts page, so it links to BrisbaneTransit's
 * Alerts with the Ferry chip on, and counts what that chip would. The ferry board loads it after hydration in place of
 * its empty BoardAlerts slot (modes.config.ts).
 */

import type { AlertsResponse } from '@bft/core/contract'
import type { BoardAlertsProps } from '@bft/ferry/app/components/BoardAlerts.tsx'
import { AlertCountLink, useCurrentAlerts } from '@bft/ui/alert-count'
import { noteCacheCopy, pollEvery } from '@bft/ui/connectivity'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { alertModes, inMode, notOver, stopModeOf } from '../lib/alert-modes.ts'

export const FERRY_ALERTS = '/alerts?mode=ferry'

/** Every minute while the board is open, as the Alerts page polls (queries.ts useAlerts). */
const poll = pollEvery(60_000)

export default function FerryAlerts({ fetcher, mode }: BoardAlertsProps) {
  // Through the board's own fetcher: importing an API client here split it off /ferry's first-load chunks.
  const q = useQuery({
    // The Alerts page's key (queries.ts useAlerts): the same /v1/alerts answer for every mode.
    queryKey: ['transit', 'alerts', 'all', mode.fixtures, mode.rt],
    queryFn: async ({ signal }): Promise<AlertsResponse> => {
      const res = await fetcher('/v1/alerts', { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status} for /v1/alerts`)
      // Marked like every API reader's body (getJson): a service-worker copy is never counted.
      return noteCacheCopy(res, await res.json())
    },
    staleTime: 60_000,
    refetchInterval: poll,
  })
  const stopMode = stopModeOf()
  const nowS = Date.now() / 1000
  const data = useCurrentAlerts(q)
  // What the Alerts page's Ferry chip counts.
  const count = data
    ? data.alerts.filter((a) => notOver(a, nowS) && inMode(a, 'ferry', alertModes(a, stopMode))).length
    : null
  return <AlertCountLink count={count} href={FERRY_ALERTS} renderLink={link} />
}

function link({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link to={href} prefetch="intent" className={className}>
      {children}
    </Link>
  )
}
