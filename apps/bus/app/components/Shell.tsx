/** BrisbaneBus chrome: header lockup, status strip, bottom navigation, settings sheet, footer. */
import type { RtState } from '@bft/core/contract'
import {
  AppHeader,
  BottomNav,
  BottomSheet,
  formatAge,
  formatClock,
  LivePill,
  type NavItem,
  OfflineBanner,
  PillButton,
  SegmentedControl,
  SettingsPill,
  StatusStrip,
} from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-bus.svg?url'
import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ATTRIBUTION } from '../lib/seo.ts'
import { readTheme, type ThemePref, writeTheme } from '../lib/storage.ts'
import { useOnline } from '../lib/useNow.ts'

export function SiteHeader({ live = true, children }: { live?: boolean; children?: ReactNode }) {
  const [settings, setSettings] = useState(false)
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
        <LivePill live={live} />
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
          <Link to="/about" className="font-semibold text-ferry-orange-deep underline" onClick={onClose}>
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
        ) : (
          'Timetable'
        )
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
export function DataBanner({ rtState, hasData }: { rtState: RtState | undefined; hasData: boolean }) {
  const online = useOnline()
  if (!online)
    return (
      <OfflineBanner
        kind="offline"
        detail={hasData ? 'Showing your saved timetable. No live times.' : undefined}
      />
    )
  if (rtState === 'unavailable') return <OfflineBanner kind="unavailable" />
  if (rtState === 'stale') return <OfflineBanner kind="stale" />
  if (rtState === 'reloading') return <OfflineBanner kind="reloading" />
  return null
}

export const NAV: NavItem[] = [
  { key: 'home', label: 'My stops', icon: 'star', href: '/' },
  { key: 'nearby', label: 'Nearby', icon: 'nearby', href: '/nearby' },
  { key: 'map', label: 'Map', icon: 'map', href: '/map' },
  { key: 'alerts', label: 'Alerts', icon: 'alert', href: '/alerts' },
]

/** One-handed bottom navigation (phones); desktop uses the header and status strip. */
export function BusNav({ active, alertCount }: { active: string; alertCount?: number }) {
  const items = NAV.map((i) =>
    i.key === 'alerts' && alertCount ? { ...i, label: `Alerts (${alertCount})` } : i,
  )
  return (
    <div className="md:hidden">
      <BottomNav
        items={items}
        active={active}
        renderLink={(item, className, children) => (
          <Link
            to={item.href}
            className={className}
            aria-current={item.key === active ? 'page' : undefined}
            prefetch="intent"
          >
            {children}
          </Link>
        )}
      />
    </div>
  )
}

/** Desktop navigation links in the status strip. */
export function DesktopNav({ active }: { active: string }) {
  return (
    <nav aria-label="Sections" className="hidden items-center gap-1.5 md:flex">
      {NAV.map((i) => (
        <Link
          key={i.key}
          to={i.href}
          aria-current={i.key === active ? 'page' : undefined}
          className={
            i.key === active
              ? 'flex h-9 items-center rounded-full bg-ferry-orange-aa px-3 text-sm font-bold text-white'
              : 'flex h-9 items-center rounded-full border border-ferry-orange/20 bg-white px-3 text-sm font-semibold text-aqua-text hover:border-ferry-orange/50 dark:bg-night-card dark:text-ferry-aqua-light'
          }
        >
          {i.label}
        </Link>
      ))}
    </nav>
  )
}

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
        <p className="mt-3 text-xs">
          <Link to="/about" className="underline hover:text-ferry-orange-deep">
            About and data sources
          </Link>
        </p>
      </div>
    </footer>
  )
}
