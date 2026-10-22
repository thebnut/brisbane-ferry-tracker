/**
 * Replaces apps/ferry/app/components/header.tsx inside BrisbaneTransit (modes.config.ts, THE-118): the one transit
 * header and the status line instead of the BrisbaneFerry lockup and the "Last updated" strip. The ferry board's
 * gear still opens its stop selector. Same exports as the original (test/nav-slots.test.ts).
 */
import { AlertCountLink } from '@bft/ui'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { type LiveProps, ModeHeader } from '../components/ModeHeader.tsx'
import { StatusLine } from '../components/StatusLine.tsx'

// The count needs the alerts (THE-118 PR 3): its own chunk after hydration; until then a plain "Alerts" link.
const FerryAlerts = lazy(() => import('./ferry-alerts.tsx'))

function AlertsFallback() {
  return (
    <AlertCountLink
      count={null}
      href="/alerts?mode=ferry"
      renderLink={({ href, className, children }) => (
        <Link to={href} className={className}>
          {children}
        </Link>
      )}
    />
  )
}

/** Alerts left the section bar (THE-118 PR 3): the ferry board shows its count beside Map. */
function BoardAlerts() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <AlertsFallback />
  return (
    <Suspense fallback={<AlertsFallback />}>
      <FerryAlerts />
    </Suspense>
  )
}

export function SiteHeader({ onSettings, ...live }: LiveProps & { onSettings?: () => void }) {
  return <ModeHeader {...live} onSettings={onSettings} />
}

export function UpdatedStrip({
  detail,
  onRefresh,
  refreshing,
  children,
  ...live
}: LiveProps & {
  updated: string
  detail: string | null
  onRefresh: () => void
  refreshing: boolean
  children?: ReactNode
}) {
  return (
    <StatusLine {...live} detail={detail} onRefresh={onRefresh} refreshing={refreshing}>
      {children}
      <BoardAlerts />
    </StatusLine>
  )
}
