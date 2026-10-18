/**
 * App chrome shared by every page: header lockup (train emblem + "BrisbaneTrain / Departure Boards"), Settings and
 * LIVE pills, bottom navigation (Home, Stations, Map, Alerts), footer with the TransLink attribution, and the
 * settings sheet (theme). Fixture mode is labelled so demo data is never mistaken for live times.
 */
import { AppHeader, BottomSheet, LivePill, SettingsPill } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-train.svg?url'
import { type ReactNode, useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { ATTRIBUTION } from '../lib/seo.ts'
import { FIXTURE_COOKIE, type Theme, writeTheme } from '../lib/storage.ts'
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
  useEffect(() => {
    // Keep fixture mode across navigation once it was asked for with ?fixtures=1.
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

/** Header, optional status strip, page body, bottom nav and footer. */
export function Shell({
  active,
  strip,
  children,
}: {
  active: string
  strip?: ReactNode
  children: ReactNode
}) {
  const [settings, setSettings] = useState(false)
  // The header pill is about the connection; the data state (stale, reloading, scheduled) has its own banner.
  const live = useOnline()
  return (
    <>
      <SiteHeader live={live} active={active} onSettings={() => setSettings(true)} />
      <FixtureNotice />
      {strip}
      <main className="mx-auto w-full max-w-6xl px-3.5 pt-3 pb-4 md:px-4">{children}</main>
      <Footer />
      <TrainNav active={active} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </>
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
