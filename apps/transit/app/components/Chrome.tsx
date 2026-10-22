/**
 * BrisbaneTransit chrome for the transit pages (Saved, Nearby, Alerts): the one header (ModeHeader.tsx, which the
 * mode pages use too), the status strip and the footer.
 */

import { DemoExitLink, formatClock, StatusStrip } from '@bft/ui'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link, useRouteLoaderData, useSearchParams } from 'react-router'
import { ModeHeader } from './ModeHeader.tsx'

/** Demo-data note in fixture mode, with the way out (the root keeps the hour-long cookie, R7-B1). */
export function FixtureNotice() {
  const root = useRouteLoaderData('root') as { fixtures?: boolean } | undefined
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

/** The header for a transit page. `live` undefined: a page without live data (What's new) claims nothing. */
export function TransitHeader({ live }: { live?: boolean }) {
  return (
    <>
      <ModeHeader live={live} />
      <FixtureNotice />
    </>
  )
}

/** "Last updated 7:38 pm" strip with a right-hand summary ("3 saved · all modes"). */
export function TransitStrip({ updatedAt, children }: { updatedAt: number | null; children?: ReactNode }) {
  return (
    <StatusStrip updated={updatedAt ? `Last updated ${formatClock(updatedAt / 1000)}` : null}>
      {children}
    </StatusStrip>
  )
}

// The ferry feedback button and sheet (its Turnstile sitekey from the root data), loaded only when asked for: they
// stay off the home page's first load (its JS budget).
const FeedbackButton = lazy(() =>
  import('@bft/ferry/app/components/FeedbackButton.tsx').then((m) => ({ default: m.FeedbackButton })),
)

/** "Send Feedback & Ideas": a link to ?feedback=1 (what /feedback redirects to), which opens the sheet. */
function FeedbackEntry() {
  const [params] = useSearchParams()
  const asked = params.get('feedback') === '1'
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (asked) setLoaded(true)
  }, [asked])
  const link = (
    <Link
      to="?feedback=1"
      preventScrollReset
      className="inline-flex min-h-11 items-center font-semibold text-ferry-orange-deep no-underline transition-colors hover:text-ferry-orange-dark"
    >
      <span aria-hidden="true">💬&nbsp;</span>Send Feedback & Ideas
    </Link>
  )
  return loaded ? (
    <Suspense fallback={link}>
      <FeedbackButton />
    </Suspense>
  ) : (
    link
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
        <p className="mt-3">
          <FeedbackEntry />
          <a
            href="/whats-new"
            className="ml-4 inline-flex min-h-11 items-center font-semibold text-ferry-orange-deep"
          >
            What’s new
          </a>
        </p>
        <p className="mt-2 text-xs text-gray-600 dark:text-night-text/70">
          BrisbaneTransit is independent and not affiliated with Translink, Queensland Rail or Brisbane City
          Council.
        </p>
      </div>
    </footer>
  )
}
