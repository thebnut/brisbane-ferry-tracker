/** BrisbaneBus chrome: header lockup, status strip, bottom navigation, settings sheet, footer. */
import type { RtState } from '@bft/core/contract'
import {
  AppHeader,
  BottomSheet,
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
import { SegmentedControl } from '@bft/ui/bus'
import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { at } from '../lib/base.ts'
import { ATTRIBUTION } from '../lib/seo.ts'
import { readTheme, type ThemePref, writeTheme } from '../lib/storage.ts'
import { useOnline } from '../lib/useNow.ts'

export function SiteHeader({ live = true, children }: { live?: boolean; children?: ReactNode }) {
  const [settings, setSettings] = useState(false)
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
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </>
  )
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [theme, setTheme] = useState<ThemePref>('system')
  useEffect(() => setTheme(readTheme()), [])
  return (
    <BottomSheet open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">Appearance</span>
          <SegmentedControl<ThemePref>
            label="Appearance"
            value={theme}
            onChange={(t) => {
              setTheme(t)
              writeTheme(t)
            }}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <p className="text-sm text-sched-text">
          Saved stops, recent searches and offline timetables stay on this device. Times refresh every 15
          seconds while the page is open.
        </p>
        <p className="text-sm">
          <Link
            to={at('/about')}
            className="font-semibold text-ferry-orange-deep underline"
            onClick={onClose}
          >
            About BrisbaneBus and data sources
          </Link>
        </p>
      </div>
    </BottomSheet>
  )
}

/** "Updated 2:41 pm · updated 12 s ago" strip with optional pills (Refresh, route filters, Map). */
export function UpdatedStrip({
  updatedAt,
  sourceS,
  nowMs,
  onRefresh,
  refreshing,
  children,
}: {
  updatedAt: number | null
  sourceS: number | null
  nowMs: number
  onRefresh?: () => void
  refreshing?: boolean
  children?: ReactNode
}) {
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
      detail={formatAge(sourceS, nowMs)}
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

export function Footer() {
  return (
    <footer className="mt-10 border-t border-gray-200 py-8 pb-32 md:pb-8 dark:border-night-card">
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
