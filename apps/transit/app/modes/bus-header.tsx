/**
 * Replaces apps/bus/app/components/header.tsx inside BrisbaneTransit (modes.config.ts, THE-118): the one transit
 * header and the status line instead of the BrisbaneBus lockup and the "Updated" strip. The gear opens the transit
 * Settings. Same exports as the original (test/nav-slots.test.ts).
 */
import { formatAge } from '@bft/ui'
import { sourceTimeS, usePageCheck } from '@bft/ui/connectivity'
import type { ReactNode } from 'react'
import { type BackLink, type LiveProps, ModeHeader } from '../components/ModeHeader.tsx'
import { StatusLine } from '../components/StatusLine.tsx'
import { useRefetchLive } from './refetch-live.ts'

export function SiteHeader({
  back,
  children,
  ...live
}: LiveProps & { back?: BackLink; children?: ReactNode }) {
  return (
    <>
      <ModeHeader {...live} back={back} />
      {/* The map's desktop section pills, until THE-118 PR 3 removes them. */}
      {children ? (
        <div className="hidden border-b border-ferry-orange/15 md:block">
          <div className="mx-auto flex max-w-6xl px-4 py-1.5">{children}</div>
        </div>
      ) : null}
    </>
  )
}

export function UpdatedStrip({
  source,
  nowMs,
  onRefresh,
  refreshing,
  children,
  ...live
}: LiveProps & {
  updatedAt: number | null
  source: { rtSourceTimestamp: number | null; generatedAt: number } | null | undefined
  nowMs: number
  onRefresh?: () => void
  refreshing?: boolean
  children?: ReactNode
}) {
  const page = usePageCheck()
  // A page with live data but no refresh of its own (the route page's vehicles): tapping refetches its live queries.
  const own = useRefetchLive()
  const fallback = live.live !== undefined && !onRefresh
  return (
    <StatusLine
      {...live}
      detail={formatAge(sourceTimeS(source, { nowMs, ...page }), nowMs)}
      onRefresh={fallback ? own.refresh : onRefresh}
      refreshing={fallback ? own.refreshing : refreshing}
    >
      {children}
    </StatusLine>
  )
}
