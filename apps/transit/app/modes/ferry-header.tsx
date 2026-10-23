/**
 * Replaces apps/ferry/app/components/header.tsx inside BrisbaneTransit (modes.config.ts, THE-118): the one transit
 * header and the status line instead of the BrisbaneFerry lockup and the "Last updated" strip. The ferry board's
 * gear still opens its stop selector. Same exports as the original (test/nav-slots.test.ts).
 */
import type { ReactNode } from 'react'
import { type LiveProps, ModeHeader } from '../components/ModeHeader.tsx'
import { StatusLine } from '../components/StatusLine.tsx'

export function SiteHeader({ onSettings, ...live }: LiveProps & { onSettings?: () => void }) {
  return <ModeHeader {...live} onSettings={onSettings} />
}

export function UpdatedStrip({
  detail,
  onRefresh,
  refreshing,
  children,
  board,
  ...live
}: LiveProps & {
  updated: string
  detail: string | null
  onRefresh: () => void
  refreshing: boolean
  children?: ReactNode
  board?: boolean
}) {
  return (
    <StatusLine {...live} detail={detail} onRefresh={onRefresh} refreshing={refreshing} board={board}>
      {children}
    </StatusLine>
  )
}
