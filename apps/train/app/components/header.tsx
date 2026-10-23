/**
 * The site header and the "Updated" strip. Their own module because BrisbaneTransit swaps exactly this file for its
 * one header and status line (apps/transit/modes.config.ts, THE-118); the standalone site keeps these. Props it
 * doesn't use here (`back`) are the transit header's.
 */
import { AppHeader, ConnectingPill, LivePill, SettingsPill, StatusStrip } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-train.svg?url'
import { createContext, type ReactNode } from 'react'
import { useOnline } from '../lib/useNow.ts'
import { DesktopNav } from './nav.tsx'

export interface LiveProps {
  live?: boolean
  /** Still waiting for the page's first answer. */
  pending?: boolean
  /** The page has no live data of its own. */
  idle?: boolean
}

/** The page's live answer as Shell works it out, for the strip below the header. */
export const ShellLive = createContext<LiveProps>({})

export function SiteHeader({
  onSettings,
  live,
  pending = false,
  idle = false,
  active,
}: LiveProps & {
  onSettings?: () => void
  /** Current section: shows the desktop section links (phones use the bottom nav). */
  active?: string
  /** The parent page, for a back link. */
  back?: { href: string; label: string }
}) {
  const online = useOnline()
  return (
    <AppHeader mode="train" logoSrc={emblem}>
      {active != null ? <DesktopNav active={active} /> : null}
      {onSettings ? <SettingsPill onClick={onSettings} compact /> : null}
      {/* BrisbaneTransit's connectionState: offline wins; then "Connecting…" while the page waits for its first answer
          (a loader that timed out at SSR, a board not yet answered); a page with no live data of its own (no `live`,
          or Shell's `idle`) claims nothing. */}
      {!online ? (
        <LivePill live={false} />
      ) : pending ? (
        <ConnectingPill />
      ) : live === undefined || idle ? null : (
        <LivePill live={live} />
      )}
    </AppHeader>
  )
}

/** "Updated 2:41 pm · updated 12 s ago" with the board's pills. */
export function UpdatedStrip({
  updated,
  detail,
  children,
  board,
}: {
  updated: ReactNode
  detail?: string | null
  children?: ReactNode
  /** On a board: below the board header, in the board's column (THE-118 PR 5). */
  board?: boolean
}) {
  return (
    <StatusStrip updated={updated} detail={detail} board={board}>
      {children}
    </StatusStrip>
  )
}
