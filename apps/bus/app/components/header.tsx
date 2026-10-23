/**
 * The site header (lockup, Settings, LIVE) and the "Updated" strip. Their own module because BrisbaneTransit swaps
 * exactly this file for its one header and status line (apps/transit/modes.config.ts, THE-118); the standalone site
 * keeps these. Props it doesn't use here (`back`) are the transit header's.
 */
import {
  AppHeader,
  ConnectingPill,
  formatAge,
  formatClock,
  LivePill,
  PillButton,
  SettingsPill,
  StatusStrip,
} from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-bus.svg?url'
import { sourceTimeS, usePageCheck } from '@bft/ui/connectivity'
import { lazy, type MouseEvent, type ReactNode, Suspense, useState } from 'react'
import { useOnline } from '../lib/useNow.ts'

export interface LiveProps {
  /** Is the page's data live? Undefined: a page without live data. */
  live?: boolean
  /** Still waiting for the page's first answer (no data, no error). */
  pending?: boolean
}

// Loaded on first open: keeps the bottom sheet and segmented control off every page's first load.
const SettingsSheet = lazy(() => import('./SettingsSheet.tsx'))

export function SiteHeader({
  live,
  pending = false,
  children,
}: LiveProps & {
  children?: ReactNode
  /** The parent page, for a back link. */
  back?: { href: string; label: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }
}) {
  const [settings, setSettings] = useState<boolean | null>(null)
  const online = useOnline()
  return (
    <>
      <AppHeader mode="bus" logoSrc={emblem}>
        {children}
        <span className="md:hidden">
          <SettingsPill compact onClick={() => setSettings(true)} />
        </span>
        <span className="hidden md:inline">
          <SettingsPill onClick={() => setSettings(true)} />
        </span>
        {/* Never LIVE while offline, whatever the page's data says. Then "Connecting…" while the page waits for its
            first answer (R32-RT1: or a non-live seed's own answer). A page with no live data of its own claims nothing
            while online, as BrisbaneTransit's connectionState. */}
        {!online ? (
          <LivePill live={false} />
        ) : pending ? (
          <ConnectingPill />
        ) : live === undefined ? null : (
          <LivePill live={live} />
        )}
      </AppHeader>
      {/* Mounted from the first open on: closing the sheet (not unmounting it) gives focus back to Settings. */}
      {settings != null ? (
        <Suspense fallback={null}>
          <SettingsSheet open={settings} onClose={() => setSettings(false)} />
        </Suspense>
      ) : null}
    </>
  )
}

/** "Updated 2:41 pm · updated 12 s ago" strip with optional pills (Refresh, route filters, Map). */
export function UpdatedStrip({
  updatedAt,
  source,
  nowMs,
  onRefresh,
  refreshing,
  children,
  board,
}: LiveProps & {
  updatedAt: number | null
  /** The response whose TransLink source age is shown ("updated 12 s ago", skew-free: @bft/ui sourceTimeS). */
  source: { rtSourceTimestamp: number | null; generatedAt: number } | null | undefined
  nowMs: number
  onRefresh?: () => void
  refreshing?: boolean
  children?: ReactNode
  /** On a board: below the board header, in the board's column (THE-118 PR 5). */
  board?: boolean
}) {
  const page = usePageCheck()
  return (
    <StatusStrip
      board={board}
      updated={
        updatedAt ? (
          <>
            Updated{' '}
            <strong className="font-semibold text-aqua-text dark:text-ferry-aqua-light">
              {formatClock(updatedAt / 1000)}
            </strong>
          </>
        ) : null
      }
      detail={formatAge(sourceTimeS(source, { nowMs, ...page }), nowMs)}
    >
      {children}
      {onRefresh ? (
        <PillButton icon="refresh" onClick={onRefresh} disabled={refreshing} label="Refresh">
          <span className="hidden sm:inline">Refresh</span>
        </PillButton>
      ) : null}
    </StatusStrip>
  )
}
