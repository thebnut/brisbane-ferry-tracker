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
  children: _sections,
  ...live
}: LiveProps & { back?: BackLink; children?: ReactNode }) {
  // The map's desktop section pills (its only children) are gone with the section bars (THE-118 PR 3).
  return <ModeHeader {...live} back={back} />
}

export function UpdatedStrip({
  source,
  nowMs,
  onRefresh,
  refreshing,
  children: _sections,
  board,
  ...live
}: LiveProps & {
  updatedAt: number | null
  source: { rtSourceTimestamp: number | null; generatedAt: number } | null | undefined
  nowMs: number
  onRefresh?: () => void
  refreshing?: boolean
  /** The bus pages' desktop section pills: gone with the section bars (THE-118 PR 3). */
  children?: ReactNode
  board?: boolean
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
      board={board}
    />
  )
}
