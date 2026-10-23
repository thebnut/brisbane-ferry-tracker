/**
 * Ferry home (THE-118 PR 8, the mode-home skeleton): the title and "Find a terminal", Saved (the first saved trip as the
 * headline, with the next departure and a big countdown, Q1; then the rest as My Transit cards), Near you (once the
 * device's position is known), the terminals as chips, and the SEO copy closed under "About ferry times".
 *
 * The first saved trip travels in the `bft_pair` cookie (favourites.ts), so the headline's rows are in the server
 * HTML; only a favourite gets there, never a pair kept for the session alone. After hydration the saved list itself
 * decides (HomeSaved.tsx, with the favourites' code).
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { DemoExitLink, Icon, OfflineBanner, useFixtureCookie, useGeolocation } from '@bft/ui'
import { asSeed, awaitingSeedAnswer, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import {
  AboutTimes,
  HeadlineCard,
  HomeSection,
  HomeTitle,
  LiveReports,
  PlaceChips,
  SavedEmpty,
  SearchPlaceholder,
  UseLocationRow,
  useLiveReports,
} from '@bft/ui/mode-home'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { Link, redirect, useNavigate } from 'react-router'
import { Footer } from '../components/Chrome.tsx'
import type HomeSaved from '../components/HomeSaved.tsx'
import { SiteHeader } from '../components/header.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { boardState } from '../lib/departures.ts'
import { CARD_ROWS, type Trip, useTripCard } from '../lib/home-card.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useFetcher } from '../lib/queries.ts'
import { HOME_META, homeJsonLd, INTRO_HEADING, INTRO_TEXT, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { FIXTURE_COOKIE, favouriteFromCookie } from '../lib/storage.ts'
import {
  boardForOldLink,
  boardHref,
  normalisePair,
  type StopPair,
  TERMINALS,
  terminalHref,
} from '../lib/terminals.ts'
import { useNow } from '../lib/useNow.ts'
import type { Route } from './+types/home'

// Client-only (Ark UI), loaded after hydration.
const TerminalSearch = lazy(() =>
  import.meta.env.SSR ? new Promise<never>(() => {}) : import('../components/TerminalSearch.tsx'),
)
// Only once the position is known.
const NearYou = lazy(() => import('../components/NearYou.tsx'))
const StopSelector = lazy(() => import('../components/StopSelector.tsx'))

export async function loader({ request, context }: Route.LoaderArgs) {
  // An old deep link (?from=&to=, R3-F2) opens that terminal's board with its "To" (THE-118 PR 5).
  const board = boardForOldLink(new URL(request.url).searchParams)
  if (board) throw redirect(board, 302)
  const { fixtures, rt, fetcher, env, fallback } = loaderEnv(request, context)
  const headline = favouriteFromCookie(request.headers.get('cookie'))
  const initial = headline
    ? await settle((signal) =>
        fetchDepartures(fetcher, headline.from, headline.to ?? '', {
          limit: CARD_ROWS,
          signal,
          validate: validateDepartures,
        }),
      )
    : null
  return {
    headline,
    initial,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    // After an API failure with FIXTURE_FALLBACK the browser polls the fixture API too (and shows the demo notice).
    // FIXTURES=1 or a fallback answer: demo data without a visitor's demo session (useFixtureCookie).
    mode: {
      fixtures: fixtures || fallback.used,
      rt,
      forced: env?.FIXTURES === '1' || fallback.used,
      allowed: env?.ALLOW_FIXTURES === '1',
    },
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const siteUrl = loaderData?.siteUrl ?? SITE_URL
  return [
    ...pageMeta({ ...HOME_META, url: `${siteUrl}/`, siteUrl }),
    { 'script:ld+json': homeJsonLd(siteUrl) },
  ]
}

const linkTo = ({ href, className, children }: { href: string; className: string; children: ReactNode }) => (
  <Link to={href} className={className} prefetch="intent">
    {children}
  </Link>
)

const sameTrip = (a: Trip | null, b: Trip | null) => a?.from === b?.from && a?.to === b?.to

/** The first saved trip, big (Q1), with the banner a board would show over it. */
function Headline({
  trip,
  initial,
  nowMs,
  mode,
  pending,
}: {
  trip: Trip
  initial: DeparturesResponse | null
  nowMs: number
  mode: DataMode
  pending: boolean
}) {
  const { card, href, empty, loading, state } = useTripCard(trip, initial, nowMs, mode)
  return (
    <>
      {state && !pending ? <OfflineBanner kind={state} /> : null}
      <HeadlineCard
        mode="ferry"
        card={card}
        empty={empty}
        loading={loading}
        href={href}
        renderLink={linkTo}
      />
    </>
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { mode, renderedAt } = loaderData
  const now = useNow(renderedAt, 5_000)
  const page = usePageCheck()
  const navigate = useNavigate()
  const fetcher = useFetcher(mode)
  // Demo mode lasts an hour from ?fixtures=1 and ends with ?fixtures=0 (R7-B1), as on the boards.
  useFixtureCookie(FIXTURE_COOKIE, mode.fixtures, mode.forced === true, mode.allowed === true)
  // The saved trips: the cookie's first one until the list is read after hydration.
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [Saved, setSaved] = useState<typeof HomeSaved | null>(null)
  const [mounted, setMounted] = useState(false)
  const [selector, setSelector] = useState(false)
  useEffect(() => {
    setMounted(true)
    let off = () => {}
    let live = true
    import('../components/HomeSaved.tsx').then(
      (m) => {
        if (!live) return
        setSaved(() => m.default)
        off = m.watchFavourites(setTrips)
      },
      () => {}, // Offline before the chunk was cached: the cookie's trip only, until the next load.
    )
    return () => {
      live = false
      off()
    }
  }, [])
  const list = trips ?? (loaderData.headline ? [loaderData.headline] : [])
  const head = list[0] ?? null
  const seed = sameTrip(head, loaderData.headline) ? loaderData.initial : null
  // Before the rows report (the server render, hydration): the headline's seed, as a board's (R32-RT1). No saved trip
  // and no position: no live rows, so the header claims nothing (#159).
  const seedState = seed ? boardState(seed, false, now, page) : null
  const reports = useLiveReports({
    live: head ? !!seed && seedState == null : undefined,
    pending: !!head && (!seed || awaitingSeedAnswer(asSeed(seed), seedState)),
  })
  const { geo, locate } = useGeolocation()
  const save = (next: StopPair) => {
    setSelector(false)
    navigate(boardHref(next.outbound.id, next.inbound.id))
  }
  return (
    <LiveReports value={reports.report}>
      <SiteHeader onSettings={() => setSelector(true)} live={reports.live} pending={reports.pending} />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-3.5 pt-4 pb-4 md:px-4">
        <HomeTitle title="Ferry">
          {/* The search, and the live ferry map beside it (THE-118 PR 9), as on Train. */}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              {mounted ? (
                <Suspense
                  fallback={<SearchPlaceholder label="Find a terminal" placeholder="Terminal name" />}
                >
                  <TerminalSearch />
                </Suspense>
              ) : (
                <SearchPlaceholder label="Find a terminal" placeholder="Terminal name" />
              )}
            </div>
            <Link
              to={at('/map')}
              className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border-2 border-ferry-orange/30 bg-white px-3.5 text-sm font-bold text-aqua-text no-underline dark:bg-night-card dark:text-ferry-aqua-light"
            >
              <Icon name="map" size={18} />
              Map
            </Link>
          </div>
        </HomeTitle>
        {mode.fixtures ? (
          <p
            role="note"
            data-banner="demo"
            className="rounded-card border border-aqua-text/30 bg-ferry-light-blue px-3.5 py-2.5 text-sm text-charcoal"
          >
            <strong className="font-bold">Demo data.</strong> A recorded weekday timetable with simulated live
            times, not today's real departures. <DemoExitLink />
          </p>
        ) : null}
        <HomeSection id="saved" title="Saved">
          {head ? (
            <Headline
              key={`${head.from}>${head.to ?? ''}`}
              trip={head}
              initial={seed}
              nowMs={now}
              mode={mode}
              pending={reports.pending}
            />
          ) : (
            <SavedEmpty />
          )}
          {Saved && list.length > 1 ? <Saved trips={list.slice(1)} nowMs={now} mode={mode} /> : null}
        </HomeSection>
        <HomeSection id="near" title="Near you">
          {geo.state === 'ok' ? (
            <Suspense fallback={null}>
              <NearYou lat={geo.lat} lon={geo.lon} nowMs={now} mode={mode} />
            </Suspense>
          ) : (
            <UseLocationRow state={geo.state} onLocate={locate} what="terminals" />
          )}
        </HomeSection>
        <HomeSection id="popular" title="All terminals">
          <PlaceChips
            places={TERMINALS.map((t) => ({ href: terminalHref(t.slug), name: cleanStopName(t.name) }))}
            renderLink={linkTo}
          />
        </HomeSection>
        <AboutTimes title="About ferry times">
          <h2 className="text-base font-bold text-aqua-text dark:text-ferry-aqua-light">{INTRO_HEADING}</h2>
          <p className="mt-2 text-sm text-gray-700 dark:text-night-text/80">{INTRO_TEXT}</p>
        </AboutTimes>
      </main>
      <Footer />
      {selector ? (
        <Suspense fallback={null}>
          <StopSelector
            initial={normalisePair(
              head
                ? { outbound: { id: head.from, name: '' }, inbound: { id: head.to ?? '', name: '' } }
                : null,
            )}
            fetcher={fetcher}
            onSave={save}
            onClose={() => setSelector(false)}
          />
        </Suspense>
      ) : null}
    </LiveReports>
  )
}
