/**
 * App chrome shared by every page: header lockup (train emblem + "BrisbaneTrain / Departure Boards"), Settings and
 * LIVE pills, bottom navigation (Home, Stations, Map, Alerts), footer with the TransLink attribution, and the
 * settings sheet (theme). Fixture mode is labelled so demo data is never mistaken for live times.
 */
import { AppHeader, BottomSheet, DemoExitLink, LivePill, SettingsPill } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-train.svg?url'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { ATTRIBUTION } from '../lib/seo.ts'
import { type Theme, writeTheme } from '../lib/storage.ts'
import { useOnline } from '../lib/useNow.ts'
import type { loader as rootLoader } from '../root.tsx'
import { DesktopNav, TrainNav } from './nav.tsx'

export { NAV } from './nav.tsx'

export const SECTION = {
  section: 'mx-auto max-w-6xl px-4 pt-4 pb-2 text-charcoal dark:text-night-text',
  heading: 'text-lg font-bold text-aqua-text md:text-xl dark:text-ferry-aqua-light',
  text: 'mt-2 max-w-3xl text-sm text-gray-700 dark:text-night-text/80',
  subheading: 'mt-4 text-sm font-semibold text-gray-700 dark:text-night-text/80',
  list: 'mt-2 flex flex-wrap gap-2 text-sm',
  link: 'inline-block rounded-full border border-ferry-orange/20 bg-white/80 px-3 py-1 text-aqua-text transition-colors hover:border-ferry-orange/50 hover:text-ferry-orange-deep dark:bg-night-card dark:text-ferry-aqua-light',
  h2: 'text-[13px] font-bold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light',
}

export function SiteHeader({
  onSettings,
  live = true,
  active,
}: {
  onSettings?: () => void
  live?: boolean
  /** Current section: shows the desktop section links (phones use the bottom nav). */
  active?: string
}) {
  return (
    <AppHeader mode="train" logoSrc={emblem}>
      {active != null ? <DesktopNav active={active} /> : null}
      {onSettings ? <SettingsPill onClick={onSettings} compact /> : null}
      <LivePill live={live} />
    </AppHeader>
  )
}

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: 'Match my device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function applyTheme(theme: Theme) {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  if (theme !== 'system') el.classList.add(theme)
  else if (matchMedia('(prefers-color-scheme: dark)').matches) el.classList.add('dark')
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const [theme, setTheme] = useState<Theme>(root?.theme ?? 'system')
  return (
    <BottomSheet open={open} onClose={onClose} title="Settings">
      <fieldset className="px-5 py-4">
        <legend className="text-sm font-semibold text-gray-700 dark:text-night-text/80">Appearance</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <label
              key={t.value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-ferry-orange/30 bg-white px-4 text-sm font-semibold has-checked:border-ferry-orange-aa has-checked:bg-ferry-orange-light dark:bg-night-2 dark:has-checked:bg-night-card"
            >
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={theme === t.value}
                onChange={() => {
                  setTheme(t.value)
                  writeTheme(t.value)
                  applyTheme(t.value)
                }}
                className="accent-ferry-orange-aa"
              />
              {t.label}
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs text-sched-text">
          Favourites and today's offline timetable are kept on this device only.
        </p>
      </fieldset>
    </BottomSheet>
  )
}

function FixtureNotice() {
  const root = useRouteLoaderData<typeof rootLoader>('root')
  if (!root?.fixtures) return null
  return (
    <p
      role="note"
      data-fixtures="true"
      className="bg-golden/25 px-3 py-1 text-center text-xs font-semibold text-charcoal dark:text-night-text"
    >
      Demo data: a recorded weekday timetable with simulated live times, not real departures. <DemoExitLink />
    </p>
  )
}

/** Boards report whether their data is live and fresh; the header pill is LIVE only while every one is. */
const LiveReport = createContext<((key: string, live: boolean | null) => void) | null>(null)

/** Tell the page header whether this board's data is live (shared liveState). Reported after hydration. */
export function useReportLive(key: string, live: boolean) {
  const report = useContext(LiveReport)
  useEffect(() => {
    report?.(key, live)
    return () => report?.(key, null)
  }, [report, key, live])
}

/** Header, optional status strip, page body, bottom nav and footer. */
export function Shell({
  active,
  strip,
  live: dataLive,
  children,
}: {
  active: string
  strip?: ReactNode
  /**
   * Is the page's live data fresh (shared liveState), from its loader data? It decides the server render and the
   * first client render; once the boards report (useReportLive, after hydration) their reports decide.
   */
  live?: boolean
  children: ReactNode
}) {
  const [settings, setSettings] = useState(false)
  const [reports, setReports] = useState<Record<string, boolean>>({})
  const report = useCallback(
    (key: string, value: boolean | null) =>
      setReports((r) => {
        if (value == null) {
          if (!(key in r)) return r
          const { [key]: _gone, ...rest } = r
          return rest
        }
        return r[key] === value ? r : { ...r, [key]: value }
      }),
    [],
  )
  // Never LIVE while offline, nor over data too old to call live on any board of the page (smoke test T5).
  const online = useOnline()
  const reported = Object.values(reports)
  const live = online && (reported.length ? reported.every(Boolean) : dataLive !== false)
  return (
    <LiveReport.Provider value={report}>
      <SiteHeader live={live} active={active} onSettings={() => setSettings(true)} />
      <FixtureNotice />
      {strip}
      <main className="mx-auto w-full max-w-6xl px-3.5 pt-3 pb-4 md:px-4">{children}</main>
      <Footer />
      <TrainNav active={active} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </LiveReport.Provider>
  )
}

export function Footer() {
  return (
    <footer className="mt-10 border-t border-gray-200 py-8 pb-28 dark:border-night-card">
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
        <p className="mt-2 text-xs text-gray-600 dark:text-night-text/70">
          BrisbaneTrain is independent and not affiliated with Queensland Rail or Translink.
        </p>
      </div>
    </footer>
  )
}
