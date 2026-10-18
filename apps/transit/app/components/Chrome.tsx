/**
 * BrisbaneTransit chrome for the transit pages (Saved, Nearby, Alerts): the transit lockup (emblem + "BrisbaneTransit
 * / Departure Boards"), Settings and LIVE pills, the status strip, the footer, and the Mode Tabs shell. Mode pages
 * keep their own app's header and lockup; only the bottom bar is shared.
 */

import { AppHeader, formatClock, LivePill, SettingsPill, StatusStrip } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-transit.svg?url'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { FIXTURE_COOKIE } from '../lib/storage.ts'
import { useOnline } from '../lib/useNow.ts'

// Loaded on first open: keeps the bottom sheet and segmented control off every page's first load.
const SettingsSheet = lazy(() => import('./SettingsSheet.tsx'))

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
  // Never LIVE while offline, whatever the page's data says.
  const online = useOnline()
  return (
    <>
      <AppHeader mode="transit" logoSrc={emblem}>
        <span className="md:hidden">
          <SettingsPill compact onClick={() => setSettings(true)} />
        </span>
        <span className="hidden md:inline">
          <SettingsPill onClick={() => setSettings(true)} />
        </span>
        <LivePill live={live && online} />
      </AppHeader>
      <FixtureNotice />
      {settings ? (
        <Suspense fallback={null}>
          <SettingsSheet open onClose={() => setSettings(false)} />
        </Suspense>
      ) : null}
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
          BrisbaneTransit is independent and not affiliated with Translink, Queensland Rail or Brisbane City
          Council.
        </p>
      </div>
    </footer>
  )
}
