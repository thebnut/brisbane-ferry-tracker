/**
 * The site header and the "Updated" strip. Their own module because BrisbaneTransit swaps exactly this file for its
 * one header and status line (apps/transit/modes.config.ts, THE-118); the standalone site keeps these. Props it
 * doesn't use here (`back`) are the transit header's.
 */
import { AppHeader, LivePill, SettingsPill, StatusStrip } from '@bft/ui'
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

/**
 * No answer yet and nothing has failed: neither LIVE nor OFFLINE (BrisbaneTransit's "Connecting…", THE-118). It never
 * carries data-live-claim, so the server render and early hydration claim nothing before the page's data arrives.
 */
function ConnectingPill() {
  return (
    <span
      data-connection="connecting"
      className="flex items-center gap-1.5 rounded-full bg-sched-bg px-3 py-1.5 text-xs font-bold text-sched-text"
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-gray-400 motion-safe:animate-pulse" />
      Connecting…
    </span>
  )
}

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
}: {
  updated: ReactNode
  detail?: string | null
  children?: ReactNode
}) {
  return (
    <StatusStrip updated={updated} detail={detail}>
      {children}
    </StatusStrip>
  )
}
