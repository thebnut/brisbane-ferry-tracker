/**
 * The site header and the "Updated" strip. Their own module because BrisbaneTransit swaps exactly this file for its
 * one header and status line (apps/transit/modes.config.ts, THE-118); the standalone site keeps these. Props it
 * doesn't use here (`pending`, `idle`, `back`) are the transit header's.
 */
import { AppHeader, LivePill, SettingsPill, StatusStrip } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-train.svg?url'
import { createContext, type ReactNode } from 'react'
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
  live = true,
  active,
}: LiveProps & {
  onSettings?: () => void
  /** Current section: shows the desktop section links (phones use the bottom nav). */
  active?: string
  /** The parent page, for a back link. */
  back?: { href: string; label: string }
}) {
  return (
    <AppHeader mode="train" logoSrc={emblem}>
      {active != null ? <DesktopNav active={active} /> : null}
      {onSettings ? <SettingsPill onClick={onSettings} compact /> : null}
      <LivePill live={live} />
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
