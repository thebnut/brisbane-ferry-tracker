/** BrisbaneBus chrome: header lockup, status strip, bottom navigation, settings sheet, footer. */
import type { RtState } from '@bft/core/contract'
import {
  AppHeader,
  DemoExitLink,
  formatAge,
  formatClock,
  LivePill,
  OfflineBanner,
  PillButton,
  SettingsPill,
  StatusStrip,
} from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-bus.svg?url'
import { sourceTimeS, usePageCheck } from '@bft/ui/connectivity'
import { lazy, type ReactNode, Suspense, useState } from 'react'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'
import { ATTRIBUTION } from '../lib/seo.ts'
import { useOnline } from '../lib/useNow.ts'

// Loaded on first open: keeps the bottom sheet and segmented control off every page's first load.
const SettingsSheet = lazy(() => import('./SettingsSheet.tsx'))

export function SiteHeader({ live = true, children }: { live?: boolean; children?: ReactNode }) {
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
        {/* Never LIVE while offline, whatever the page's data says. */}
        <LivePill live={live && online} />
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
}: {
  updatedAt: number | null
  /** The response whose TransLink source age is shown ("updated 12 s ago", skew-free: @bft/ui sourceTimeS). */
  source: { rtSourceTimestamp: number | null; generatedAt: number } | null | undefined
  nowMs: number
  onRefresh?: () => void
  refreshing?: boolean
  children?: ReactNode
}) {
  const page = usePageCheck()
  return (
    <StatusStrip
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

/** rtState / connectivity banner (B-States offline and error panels share these words). */
export function DataBanner({
  rtState,
  hasData,
  generation,
  offline,
}: {
  /** The board shows an offline copy (its own data says so, whatever other requests did; R6-B1). */
  offline?: boolean
  rtState: RtState | undefined
  hasData: boolean
  /** staticGeneration of the response: "fixture-…" means recorded demo data (fixture mode or staging fallback). */
  generation?: string | null
}) {
  const online = useOnline()
  const demo = generation?.startsWith('fixture-') ? (
    <p
      data-banner="demo"
      role="status"
      className="rounded-card border border-aqua-text/30 bg-ferry-light-blue px-3.5 py-2.5 text-sm text-charcoal dark:bg-night-card dark:text-night-text"
    >
      <strong className="font-bold">Demo data.</strong> A recorded weekday timetable with simulated live
      times, for previewing the app. <DemoExitLink />
    </p>
  ) : null
  let rt: ReactNode = null
  if (!online || offline)
    rt = (
      <OfflineBanner
        kind="offline"
        detail={hasData ? 'Showing timetable times. No live times.' : undefined}
      />
    )
  else if (rtState === 'unavailable' || rtState === 'stale' || rtState === 'reloading')
    rt = <OfflineBanner kind={rtState} />
  return demo || rt ? (
    <>
      {demo}
      {rt}
    </>
  ) : null
}

export { BusNav, DesktopNav, NAV } from './nav.tsx'

/**
 * The page footer. On phones it ends clear of the bottom nav; `aboveSheet` (the home) also clears the fixed "Find a
 * stop" sheet above the nav (SearchPanel, about 162 px tall), so its last links can still be tapped.
 */
export function Footer({ aboveSheet = false }: { aboveSheet?: boolean }) {
  return (
    <footer
      className={`mt-10 border-t border-gray-200 py-8 ${aboveSheet ? 'pb-[calc(max(env(safe-area-inset-bottom),6px)+var(--bft-bottom-bar,58px)+166px+1.5rem)]' : 'pb-32'} md:pb-8 dark:border-night-card`}
    >
      <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-700 dark:text-night-text/80">
        <p>
          {ATTRIBUTION.text}{' '}
          <span className="whitespace-nowrap">
            — licensed under{' '}
            <a href={ATTRIBUTION.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {ATTRIBUTION.licenceName}
            </a>
          </span>
        </p>
        <p className="mt-2">Live times refresh every 15 seconds • All times in Brisbane time</p>
        <p className="mt-3">
          {/* A document link: /feedback redirects to the transit site's feedback sheet (R7, R8-FB). */}
          <a
            href="/feedback"
            className="inline-flex min-h-11 items-center font-semibold text-ferry-orange-deep no-underline transition-colors hover:text-ferry-orange-dark"
          >
            <span aria-hidden="true">💬&nbsp;</span>Send Feedback & Ideas
          </a>
          <a
            href="/whats-new"
            className="ml-4 inline-flex min-h-11 items-center font-semibold text-ferry-orange-deep"
          >
            What’s new
          </a>
        </p>
        <p className="mt-3 text-xs">
          <Link to={at('/about')} className="underline hover:text-ferry-orange-deep">
            About and data sources
          </Link>
        </p>
      </div>
    </footer>
  )
}
