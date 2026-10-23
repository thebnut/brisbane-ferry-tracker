/**
 * App chrome shared by every page: header lockup (train emblem + "BrisbaneTrain / Departure Boards"), Settings and
 * LIVE pills, bottom navigation (Home, Stations, Map, Alerts), footer with the TransLink attribution, and the
 * settings sheet (theme, My Transit stops; lazy: SettingsSheet.tsx). Fixture mode is labelled so demo data is never mistaken for live times.
 */
import { DemoExitLink } from '@bft/ui'
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { useRouteLoaderData } from 'react-router'
import { ATTRIBUTION } from '../lib/seo.ts'
import { useOnline } from '../lib/useNow.ts'
import type { loader as rootLoader } from '../root.tsx'
import { type LiveProps, ShellLive, SiteHeader } from './header.tsx'
import { TrainNav } from './nav.tsx'

export { SiteHeader } from './header.tsx'
export { NAV } from './nav.tsx'

// Loaded on first open: keeps the bottom sheet off every page's first load.
const SettingsSheet = lazy(() => import('./SettingsSheet.tsx'))

export const SECTION = {
  section: 'mx-auto max-w-6xl px-4 pt-4 pb-2 text-charcoal dark:text-night-text',
  heading: 'text-lg font-bold text-aqua-text md:text-xl dark:text-ferry-aqua-light',
  text: 'mt-2 max-w-3xl text-sm text-gray-700 dark:text-night-text/80',
  subheading: 'mt-4 text-sm font-semibold text-gray-700 dark:text-night-text/80',
  list: 'mt-2 flex flex-wrap gap-2 text-sm',
  link: 'inline-block rounded-full border border-ferry-orange/20 bg-white/80 px-3 py-1 text-aqua-text transition-colors hover:border-ferry-orange/50 hover:text-ferry-orange-deep dark:bg-night-card dark:text-ferry-aqua-light',
  h2: 'text-[13px] font-bold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light',
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

/**
 * Boards report whether their data is live and fresh; the header pill is LIVE only while every one is. A board still
 * waiting for its first answer reports 'pending': not live either.
 */
type Report = boolean | 'pending'
const LiveReport = createContext<((key: string, live: Report | null) => void) | null>(null)

/**
 * Tell the page header whether this board's data is live (shared liveState), or that it has no answer yet (no data, no
 * error: BrisbaneTransit's header says "Connecting…" then, THE-118). Reported after hydration.
 */
export function useReportLive(key: string, live: boolean, pending = false) {
  const report = useContext(LiveReport)
  const value: Report = pending ? 'pending' : live
  useEffect(() => {
    report?.(key, value)
    return () => report?.(key, null)
  }, [report, key, value])
}

/** Header, optional status strip, page body, bottom nav and footer. */
export function Shell({
  active,
  strip,
  live: dataLive,
  pending = false,
  back,
  children,
}: {
  active: string
  strip?: ReactNode
  /**
   * Is the page's live data fresh (shared liveState), from its loader data? It decides the server render and the
   * first client render; once the boards report (useReportLive, after hydration) their reports decide.
   */
  live?: boolean
  /** Still waiting for the page's first answer (no data, no error), until the boards report (useReportLive). */
  pending?: boolean
  /** The parent page, for the header's back link (BrisbaneTransit). */
  back?: { href: string; label: string }
  children: ReactNode
}) {
  const [settings, setSettings] = useState<boolean | null>(null)
  const [reports, setReports] = useState<Record<string, Report>>({})
  const report = useCallback(
    (key: string, value: Report | null) =>
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
  const live = online && (reported.length ? reported.every((r) => r === true) : dataLive !== false)
  const state: LiveProps = {
    live,
    // Like `live`: from the page until its boards report, then theirs.
    pending: reported.length ? reported.includes('pending') : pending,
    idle: dataLive === undefined && reported.length === 0,
  }
  return (
    <LiveReport.Provider value={report}>
      <SiteHeader {...state} active={active} back={back} onSettings={() => setSettings(true)} />
      <FixtureNotice />
      {/* The status strip reads the page's live answer: above the page, or a board's below its header (THE-118 PR 5). */}
      <ShellLive.Provider value={state}>
        {strip}
        <main className="mx-auto w-full max-w-6xl px-3.5 pt-3 pb-4 md:px-4">{children}</main>
      </ShellLive.Provider>
      <Footer />
      <TrainNav active={active} />
      {/* Mounted from the first open on: closing the sheet (not unmounting it) gives focus back to Settings. */}
      {settings != null ? (
        <Suspense fallback={null}>
          <SettingsSheet open={settings} onClose={() => setSettings(false)} />
        </Suspense>
      ) : null}
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
        <p className="mt-2 text-xs text-gray-600 dark:text-night-text/70">
          BrisbaneTrain is independent and not affiliated with Queensland Rail or Translink.
        </p>
      </div>
    </footer>
  )
}
