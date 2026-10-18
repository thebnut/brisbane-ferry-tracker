/**
 * BrisbaneTransit chrome for the transit pages (Saved, Nearby, Alerts): the transit lockup (emblem + "BrisbaneTransit
 * / Departure Boards"), Settings and LIVE pills, the status strip, the footer, and the Mode Tabs shell. Mode pages
 * keep their own app's header and lockup; only the bottom bar is shared.
 */
import {
  AppHeader,
  BottomSheet,
  formatClock,
  Icon,
  LivePill,
  MODE_TABS,
  ModeTabs,
  type NavItem,
  SegmentedControl,
  SettingsPill,
  StatusStrip,
} from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-transit.svg?url'
import { KEYS as BUS_KEYS } from '@bft/bus/app/lib/storage.ts'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation, useRouteLoaderData } from 'react-router'
import { FIXTURE_COOKIE, safe, THEME_COOKIE } from '../lib/storage.ts'

export type ThemePref = 'system' | 'light' | 'dark'

function applyTheme(pref: ThemePref) {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  if (pref !== 'system') el.classList.add(pref)
  else if (matchMedia('(prefers-color-scheme: dark)').matches) el.classList.add('dark')
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useRouteLoaderData('root') as { theme?: ThemePref } | undefined
  const [theme, setTheme] = useState<ThemePref>(root?.theme ?? 'system')
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
              safe(() => {
                // biome-ignore lint/suspicious/noDocumentCookie: plain preference cookie, shared with every tab.
                document.cookie = `${THEME_COOKIE}=${t}; path=/; samesite=lax; max-age=31536000`
                // The bus pages' settings read it from localStorage.
                if (t === 'system') localStorage.removeItem(BUS_KEYS.THEME)
                else localStorage.setItem(BUS_KEYS.THEME, t)
              }, undefined)
              applyTheme(t)
            }}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <p className="text-sm text-sched-text">
          Saved stops come from the Ferry, Train and Bus tabs and stay on this device. Times refresh every 15 seconds
          while the page is open.
        </p>
      </div>
    </BottomSheet>
  )
}

/** Demo-data note in fixture mode (and keeps fixture mode across navigation once asked for with ?fixtures=1). */
export function FixtureNotice() {
  const root = useRouteLoaderData('root') as { fixtures?: boolean } | undefined
  useEffect(() => {
    if (!root?.fixtures) return
    if (new URLSearchParams(location.search).get('fixtures') === '1')
      // biome-ignore lint/suspicious/noDocumentCookie: session cookie for a developer switch.
      document.cookie = `${FIXTURE_COOKIE}=1; path=/; samesite=lax`
  }, [root?.fixtures])
  if (!root?.fixtures) return null
  return (
    <p
      role="note"
      data-fixtures="true"
      className="bg-golden/25 px-3 py-1 text-center text-xs font-semibold text-charcoal dark:text-night-text"
    >
      Demo data: a recorded weekday timetable with simulated live times, not real departures.
    </p>
  )
}

export function TransitHeader({ live = true }: { live?: boolean }) {
  const [settings, setSettings] = useState(false)
  return (
    <>
      <AppHeader mode="transit" logoSrc={emblem}>
        <span className="md:hidden">
          <SettingsPill compact onClick={() => setSettings(true)} />
        </span>
        <span className="hidden md:inline">
          <SettingsPill onClick={() => setSettings(true)} />
        </span>
        <LivePill live={live} />
      </AppHeader>
      <FixtureNotice />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </>
  )
}

/** "Last updated 7:38 pm" strip with a right-hand summary ("3 saved · all modes"). */
export function TransitStrip({ updatedAt, children }: { updatedAt: number | null; children?: ReactNode }) {
  return (
    <StatusStrip updated={updatedAt ? `Last updated ${formatClock(updatedAt / 1000)}` : 'Timetable'}>
      {children}
    </StatusStrip>
  )
}

export function TransitFooter() {
  return (
    <footer className="mt-10 border-t border-gray-200 py-8 dark:border-night-card">
      <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-700 dark:text-night-text/80">
        <p>
          Data: Translink SEQ GTFS and GTFS-RT{' '}
          <span className="whitespace-nowrap">
            — licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              CC BY 4.0
            </a>
          </span>
        </p>
        <p className="mt-2">Live times refresh every 15 seconds • All times in Brisbane time</p>
        <p className="mt-2 text-xs text-gray-600 dark:text-night-text/70">
          BrisbaneTransit is independent and not affiliated with Translink, Queensland Rail or Brisbane City Council.
        </p>
      </div>
    </footer>
  )
}

/** Tab order on phones (X-* boards): Ferry | Train | Bus | Nearby | Saved. Saved is the home page. */
export const TABS: NavItem[] = MODE_TABS.map((t) => (t.key === 'saved' ? { ...t, href: '/' } : t))

export function activeTab(pathname: string): string {
  for (const k of ['ferry', 'train', 'bus', 'nearby'])
    if (pathname === `/${k}` || pathname.startsWith(`/${k}/`)) return k
  return pathname === '/' ? 'saved' : ''
}

/** The Mode Tabs shell: bottom bar on phones, a pill row above the page on desktop (X-Desktop, Saved first). */
export function ModeBar() {
  const { pathname } = useLocation()
  const active = activeTab(pathname)
  return (
    <>
      <div className="md:hidden">
        <ModeTabs
          items={TABS}
          active={active}
          renderLink={(item, className, children) => (
            <Link
              to={item.href}
              prefetch="intent"
              className={className}
              aria-current={item.key === active ? 'page' : undefined}
            >
              {children}
            </Link>
          )}
        />
      </div>
      {/* Phones: room for the Mode Tabs (and a mode's section pills just above them). */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </>
  )
}

const DESKTOP_ORDER = ['saved', 'ferry', 'train', 'bus', 'nearby']

export function DesktopModeBar() {
  const { pathname } = useLocation()
  const active = activeTab(pathname)
  const items = DESKTOP_ORDER.map((k) => TABS.find((t) => t.key === k) as NavItem)
  return (
    <nav aria-label="Modes" className="hidden border-b border-ferry-orange/20 bg-white/95 md:block dark:bg-night-2/95">
      <ul className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        {items.map((i) => {
          const on = i.key === active
          return (
            <li key={i.key}>
              <Link
                to={i.href}
                prefetch="intent"
                aria-current={on ? 'page' : undefined}
                className={
                  on
                    ? 'flex h-10 items-center gap-1.5 rounded-full bg-ferry-orange-aa px-4 text-sm font-bold text-white no-underline'
                    : 'flex h-10 items-center gap-1.5 rounded-full border border-ferry-orange/25 bg-white px-3.5 text-sm font-semibold text-gray-700 no-underline dark:bg-night-card dark:text-night-text'
                }
              >
                <Icon name={i.icon} size={18} />
                {i.label}
              </Link>
            </li>
          )
        })}
        <li className="ml-auto">
          <Link
            to="/alerts"
            prefetch="intent"
            className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ferry-orange-deep no-underline dark:text-ferry-sunset"
          >
            <Icon name="alert" size={18} />
            Alerts
          </Link>
        </li>
      </ul>
    </nav>
  )
}
