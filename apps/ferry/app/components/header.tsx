/**
 * The site header and the "Last updated" strip. Their own module because BrisbaneTransit swaps exactly this file for
 * its one header and status line (apps/transit/modes.config.ts, THE-118); the standalone site keeps these. Props it
 * doesn't use here (`pending`) are the transit header's.
 */
import { AppHeader, LivePill, PillButton, SettingsPill, StatusStrip } from '@bft/ui'
import lockup489 from '@bft/ui/assets/ferry-lockup.webp?url'
import lockup236 from '@bft/ui/assets/ferry-lockup-236.webp?url'
import lockup360 from '@bft/ui/assets/ferry-lockup-360.webp?url'
import type { ReactNode } from 'react'

export interface LiveProps {
  /** Is the page's data live? Undefined: a page without live data. */
  live?: boolean
  /** Still waiting for the page's first answer. */
  pending?: boolean
}

export function SiteHeader({ onSettings, live = true }: LiveProps & { onSettings?: () => void }) {
  return (
    <AppHeader
      mode="ferry"
      logoSrc={lockup360}
      logoSrcSet={`${lockup236} 236w, ${lockup360} 360w, ${lockup489} 489w`}
    >
      {onSettings ? <SettingsPill onClick={onSettings} /> : null}
      <LivePill live={live} />
    </AppHeader>
  )
}

/** "Last updated 2:41 pm · updated 12 s ago", the board's pills, then Refresh. */
export function UpdatedStrip({
  updated,
  detail,
  onRefresh,
  refreshing,
  children,
}: LiveProps & {
  updated: string
  detail: string | null
  onRefresh: () => void
  refreshing: boolean
  children?: ReactNode
}) {
  return (
    <StatusStrip updated={updated} detail={detail}>
      {children}
      <PillButton icon="refresh" label="Refresh" onClick={onRefresh} disabled={refreshing}>
        <span className="sr-only md:not-sr-only">Refresh</span>
      </PillButton>
    </StatusStrip>
  )
}
