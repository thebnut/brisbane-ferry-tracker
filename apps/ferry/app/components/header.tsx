/**
 * The site header and the "Last updated" strip. Their own module because BrisbaneTransit swaps exactly this file for
 * its one header and status line (apps/transit/modes.config.ts, THE-118); the standalone site keeps these. Props it
 * doesn't use here (`back`) are the transit header's.
 */
import { AppHeader, ConnectingPill, LivePill, PillButton, SettingsPill, StatusStrip } from '@bft/ui'
import lockup489 from '@bft/ui/assets/ferry-lockup.webp?url'
import lockup236 from '@bft/ui/assets/ferry-lockup-236.webp?url'
import lockup360 from '@bft/ui/assets/ferry-lockup-360.webp?url'
import type { MouseEvent, ReactNode } from 'react'
import { useOnline } from '../lib/useNow.ts'

export interface LiveProps {
  /** Is the page's data live? Undefined: a page without live data. */
  live?: boolean
  /** Still waiting for the page's first answer. */
  pending?: boolean
}

export function SiteHeader({
  onSettings,
  live,
  pending = false,
}: LiveProps & {
  onSettings?: () => void
  /** The parent page, for the transit header's back link (a trip's board). */
  back?: { href: string; label: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }
}) {
  const online = useOnline()
  return (
    <AppHeader
      mode="ferry"
      logoSrc={lockup360}
      logoSrcSet={`${lockup236} 236w, ${lockup360} 360w, ${lockup489} 489w`}
    >
      {onSettings ? <SettingsPill onClick={onSettings} /> : null}
      {/* BrisbaneTransit's connectionState: offline wins; then "Connecting…" while the page waits for its first answer
          (R32-RT1: or a non-live seed's own answer); a page with no live data of its own claims nothing. */}
      {!online ? (
        <LivePill live={false} />
      ) : pending ? (
        <ConnectingPill />
      ) : live === undefined ? null : (
        <LivePill live={live} />
      )}
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
  board,
}: LiveProps & {
  updated: string
  detail: string | null
  onRefresh: () => void
  refreshing: boolean
  children?: ReactNode
  /** On a board: below the board header, in the board's column (THE-118 PR 5). */
  board?: boolean
}) {
  return (
    <StatusStrip updated={updated} detail={detail} board={board}>
      {children}
      <PillButton icon="refresh" label="Refresh" onClick={onRefresh} disabled={refreshing}>
        <span className="sr-only md:not-sr-only">Refresh</span>
      </PillButton>
    </StatusStrip>
  )
}
