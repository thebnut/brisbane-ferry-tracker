/**
 * Mode home (THE-118 PR 8): the one skeleton of /ferry, /train and /bus, top to bottom:
 *  1. a large title and the mode's search ("Find a terminal / station / stop");
 *  2. Saved: the mode's favourites as My Transit cards (SavedTripCard), or one line saying how to save one;
 *  3. Near you: the nearest places with their next departure (Nearby rows), only once location is granted, otherwise
 *     one "Use my location" row (location is never asked for on page load);
 *  4. Popular: places as chips;
 *  5. the SEO copy, closed under "About … times" (a `<details>`, so it stays in the server HTML).
 * Each app's home composes these with its own data; only the homes load this module (its own chunk in BrisbaneTransit).
 *
 * The live rows (a saved card, a Near you row) report to the page's header the way a board does (useReportLive): LIVE
 * only while every reported row is live, "Connecting…" while one waits for its own answer (R32-RT1), nothing claimed
 * by a page without live rows (#159).
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { cx } from './cx.ts'
import { dayMarker, formatClock, formatDistance, minutesUntil, vesselName } from './format.ts'
import { Icon } from './icons.tsx'
import { MODE_TEXT, ModePin, ModeTile, NearbyDepartureRow, type TransitMode } from './multimodal.tsx'
import { BigCountdown } from './row.tsx'

type RenderLink = (props: { href: string; className: string; children: ReactNode }) => ReactNode

const link = (href: string, className: string, children: ReactNode, renderLink?: RenderLink) =>
  renderLink ? (
    renderLink({ href, className, children })
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  )

// ---- page state ----

/**
 * A live row's report, as a board's (train Chrome.tsx): live, not live, 'pending' (no answer of its own yet, or a
 * non-live seed's own refetch still out) or 'failed-live' (live data still shown after a failed request: live for the
 * pill, but a failure no waiting row may hide).
 */
type Report = boolean | 'pending' | 'failed-live'
const LiveReport = createContext<((key: string, value: Report | null) => void) | null>(null)

/** Tell the page header whether this row's data is live (shared liveState), still waiting, or failed. */
export function useReportLive(key: string, live: boolean, pending = false, failed = false) {
  const report = useContext(LiveReport)
  const value: Report = failed ? (live ? 'failed-live' : false) : pending ? 'pending' : live
  useEffect(() => {
    report?.(key, value)
    return () => report?.(key, null)
  }, [report, key, value])
}

/**
 * The page's live answer from its rows' reports; before any row reports (the server render, hydration), the
 * loader's (`initial`). No live row at all: `live` undefined, so the header claims nothing.
 */
export function useLiveReports(initial: { live?: boolean; pending?: boolean }) {
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
  const reported = Object.values(reports)
  const live = reported.length ? reported.every((r) => r === true || r === 'failed-live') : initial.live
  // A row whose own answer isn't live, or whose request failed, wins over one still waiting (R32-RT1).
  const pending = reported.length
    ? reported.includes('pending') && reported.every((r) => r === 'pending' || r === true)
    : initial.pending === true
  return { live, pending, report }
}

/** Where the rows report: the provider of useLiveReports' `report`. */
export const LiveReports = LiveReport.Provider

// ---- cards ----

export interface HomeCard {
  label: string
  title: string
  /** The next departure is live (and the data is: the caller passes only live data, else a timetable copy). */
  live: boolean
  time: string | null
  detail: string | null
  minutes: number | null
  /** The clock time of the next departure ("7:46 pm") and its next-day marker, for the big countdown. */
  clock: string | null
  day: string | null
  later: string | null
  /** Epoch s of the next departure, for the soonest card. */
  next: number | null
}

/** The part of a /v1 departures response a card reads (@bft/core's DeparturesResponse fits it). */
export interface CardResponse {
  rtState: string
  stop: { name: string }
  to: { name: string } | null
  departures: ReadonlyArray<{
    status: string
    schedDep: number
    estDep: number | null
    schedArrTo: number | null
    estArrTo: number | null
    route: { short: string; long?: string }
    headsign: string
    platform: string | null
    vehicleId: string | null
  }>
}

const clockDay = (epochS: number, nowMs: number) => {
  const day = dayMarker(epochS, nowMs)
  return day ? `${formatClock(epochS)} ${day}` : formatClock(epochS)
}
const bare = (name: string | undefined) => name?.replace(/ (station|ferry terminal)$/i, '')

/**
 * A saved card from a departures response, as My Transit's (apps/transit saved.tsx cardModel; that page keeps its own
 * copy off this module, test/mode-home.test.ts checks the two agree). `title` is the card's name when the response
 * doesn't give a better one.
 */
export function homeCard(
  mode: TransitMode,
  res: CardResponse | undefined,
  nowMs: number,
  title: string,
  stopKey: string,
): HomeCard {
  // Only boardable services: a cancelled or skipped (not stopping here) one is never "next".
  // Soonest first by the time shown: a board that dropped its live estimates keeps their order (Codex r1).
  const rows = (res?.departures ?? [])
    .filter((d) => d.status !== 'cancelled' && d.status !== 'skipped')
    .sort((a, b) => (a.estDep ?? a.schedDep) - (b.estDep ?? b.schedDep))
  const first = rows[0]
  const dep = first ? (first.estDep ?? first.schedDep) : null
  const arr = first ? (first.estArrTo ?? first.schedArrTo) : null
  let label: string
  let detail: string | null = null
  if (mode === 'bus') {
    label = `Bus · ${res?.stop.name ?? title}`
    if (first) title = `${first.route.short} to ${first.headsign}`
    detail = first?.platform ? `Platform ${first.platform}` : `Stop ${stopKey}`
  } else if (mode === 'train') {
    label = `Train · ${first?.route.long ?? 'Station'}`
    if (res?.stop.name)
      title = res.to?.name ? `${bare(res.stop.name)} → ${bare(res.to.name)}` : (bare(res.stop.name) ?? title)
    detail = first
      ? [first.platform ? `Platform ${first.platform}` : null, `To ${bare(first.headsign)}`]
          .filter(Boolean)
          .join(' · ')
      : null
  } else {
    label = `Ferry · ${first && /^F1\d$/.test(first.route.short) ? 'Express' : 'All stops'}`
    detail = first ? [first.route.short, vesselName(first.vehicleId)].filter(Boolean).join(' · ') : null
  }
  return {
    label,
    title,
    live: res?.rtState === 'live' && first?.status === 'live',
    time: dep ? `${clockDay(dep, nowMs)}${arr ? ` → ${clockDay(arr, nowMs)}` : ''}` : null,
    detail,
    minutes: dep ? minutesUntil(dep, nowMs) : null,
    clock: dep ? formatClock(dep) : null,
    day: dep ? dayMarker(dep, nowMs) : null,
    later:
      rows
        .slice(1, 3)
        .map((d) => `${clockDay(d.estDep ?? d.schedDep, nowMs)} ${d.route.short}`)
        .join('   ') || null,
    next: dep,
  }
}

function LivePill() {
  return (
    <span
      data-live-claim=""
      className="shrink-0 rounded-full bg-ferry-orange-aa px-2.5 py-0.5 text-[11px] font-bold text-white"
    >
      LIVE
    </span>
  )
}

/**
 * Ferry home's headline (Q1): the first saved trip as one big card, its next departure with the board's big
 * countdown, so opening the app still shows "my ferry" first. It opens that trip's board.
 */
export function HeadlineCard({
  mode,
  card,
  empty,
  loading = false,
  href,
  renderLink,
}: {
  mode: TransitMode
  card: HomeCard
  /** Shown instead of the times (loading, no more departures). */
  empty?: ReactNode
  loading?: boolean
  href: string
  renderLink?: RenderLink
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <ModeTile mode={mode} />
          <span className="flex min-w-0 flex-col">
            <span
              className={cx(
                'truncate text-[11px] font-extrabold tracking-[0.06em] uppercase',
                MODE_TEXT[mode],
              )}
            >
              {card.label}
            </span>
            <span className="truncate text-lg font-extrabold">{card.title}</span>
          </span>
        </span>
        {card.live ? <LivePill /> : null}
      </span>
      {empty ? (
        <span
          data-loading={loading ? '' : undefined}
          className="text-sm text-sched-text dark:text-night-text/70"
        >
          {empty}
        </span>
      ) : (
        <>
          <span className="flex items-end justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-gray-600 dark:text-night-text/70">
                Next departure
              </span>
              <span data-saved-time="" className="text-[17px] font-bold tabular">
                {card.time}
              </span>
              {card.detail ? (
                <span className="truncate text-[13px] text-gray-600 dark:text-night-text/70">
                  {card.detail}
                </span>
              ) : null}
            </span>
            {card.minutes != null ? (
              <BigCountdown minutes={card.minutes} time={card.clock ?? ''} dayMarker={card.day} size="lg" />
            ) : null}
          </span>
          {card.later ? (
            <span className="flex gap-2 border-t border-dashed border-ferry-orange/25 pt-2 text-[13px] tabular text-gray-700 dark:text-night-text/80">
              <span className="font-semibold">Then</span>
              <span>{card.later}</span>
            </span>
          ) : null}
        </>
      )}
    </>
  )
  return (
    <div data-headline="">
      {link(
        href,
        'bg-hot flex flex-col gap-3 rounded-card border-2 border-ferry-orange px-4 py-4 text-inherit no-underline shadow-hot',
        body,
        renderLink,
      )}
    </div>
  )
}

// ---- sections ----

/** The large title ("Ferry") with the mode's search under it. */
export function HomeTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-[28px] leading-tight font-extrabold">{title}</h1>
      {children}
    </div>
  )
}

/**
 * The search field until the mode's combobox (client-only, its own chunk) has loaded, and in the server HTML: the
 * same label and field, so nothing moves when it arrives.
 */
export function SearchPlaceholder({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-gray-700 dark:text-night-text/80">{label}</span>
      <span className="relative">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ferry-orange"
        />
        <input
          readOnly
          placeholder={placeholder}
          className="h-12 w-full rounded-card border-2 border-ferry-orange/30 bg-white px-10 text-base font-semibold text-aqua-text placeholder:font-normal placeholder:text-gray-500 dark:bg-night-2"
        />
      </span>
    </label>
  )
}

/** One section with its small upper-case heading ("SAVED", "NEAR YOU", "POPULAR"). */
export function HomeSection({
  id,
  title,
  action,
  children,
}: {
  id: string
  title: string
  /** Beside the heading (e.g. a Map link). */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} data-home-section={id} className="flex flex-col gap-2.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2
          id={id}
          className="text-[13px] font-bold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Saved, with nothing saved for this mode. */
export function SavedEmpty() {
  return (
    <p className="flex items-center gap-2 rounded-card bg-white/90 px-4 py-3.5 text-sm shadow-card dark:bg-night-card">
      <Icon name="star" size={20} className="shrink-0 text-ferry-orange-deep dark:text-ferry-sunset" />
      <span>Tap ☆ on any board to save it.</span>
    </p>
  )
}

/** Near you, before location is granted: one row. `state` is useGeolocation's. */
export function UseLocationRow({
  state,
  onLocate,
  what,
}: {
  state: 'idle' | 'locating' | 'denied' | 'unavailable'
  onLocate: () => void
  /** "terminals", "stations", "stops". */
  what: string
}) {
  const off = state === 'denied' || state === 'unavailable'
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-card bg-white/90 px-4 py-2.5 shadow-card dark:bg-night-card">
      <Icon name="pin" size={20} className="shrink-0 text-aqua-text dark:text-ferry-aqua-light" />
      <span className="min-w-0 flex-1 text-sm">
        {off
          ? `Location is off. Search for ${what} instead, or allow location and try again.`
          : `See the nearest ${what} and their next departures.`}
      </span>
      <button
        type="button"
        onClick={onLocate}
        disabled={state === 'locating'}
        className="flex min-h-11 shrink-0 items-center rounded-full border-2 border-ferry-orange/40 bg-white px-3.5 text-sm font-bold text-ferry-orange-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ferry-orange disabled:opacity-60 dark:bg-night-2 dark:text-ferry-sunset"
      >
        {state === 'locating' ? 'Locating…' : 'Use my location'}
      </button>
    </div>
  )
}

/** About 80 m a minute, rounded up: "3 min walk" (as Nearby's). */
export const walkMinutes = (metres: number) => Math.max(1, Math.ceil(metres / 80))

/** Nearby's cue for a departure: can you make it on foot? */
export function walkCue(
  departsInMin: number,
  walkMin: number,
): { text: string; tone: 'late' | 'hurry' | 'good' } {
  if (departsInMin < walkMin) return { text: 'Too late', tone: 'late' }
  if (departsInMin < walkMin + 3) return { text: 'Hurry', tone: 'hurry' }
  if (departsInMin < walkMin + 10) return { text: 'On your way', tone: 'good' }
  return { text: 'Plenty of time', tone: 'good' }
}

/**
 * One Near you place with its next departure, as a Nearby row (pin, route tile, destination, place · walk,
 * countdown and walking cue). Without one: the place and why (still loading, nothing more today).
 */
export function NearPlaceRow({
  mode,
  name,
  metres,
  href,
  next,
  loading = false,
  renderLink,
}: {
  mode: TransitMode
  name: string
  metres: number
  href: string
  next: { route: string; to: string; minutes: number } | null
  loading?: boolean
  renderLink?: RenderLink
}) {
  const walk = walkMinutes(metres)
  const where = `${formatDistance(metres)} · ${walk} min walk`
  return (
    <li data-near={name}>
      {next ? (
        <NearbyDepartureRow
          mode={mode}
          route={next.route}
          to={next.to}
          stop={name}
          walk={where}
          minutes={next.minutes}
          cue={walkCue(next.minutes, walk)}
          href={href}
          renderLink={renderLink}
        />
      ) : (
        link(
          href,
          'flex min-h-14 items-center gap-2.5 rounded-card bg-white/90 px-3 py-2 text-inherit no-underline shadow-card dark:bg-night-card',
          <>
            <ModePin mode={mode} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-bold">{name}</span>
              <span
                data-loading={loading ? '' : undefined}
                className="truncate text-xs text-sched-text dark:text-night-text/70"
              >
                {loading ? 'Getting departures…' : 'No more departures today'} · {where}
              </span>
            </span>
          </>,
          renderLink,
        )
      )}
    </li>
  )
}

export const CHIP =
  'flex min-h-11 items-center rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-sm font-semibold text-aqua-text no-underline transition-colors hover:border-ferry-orange/50 hover:text-ferry-orange-deep dark:bg-night-card dark:text-ferry-aqua-light'

/** Popular: places as chips, then any extra chip (e.g. "All 154 stations"). */
export function PlaceChips({
  places,
  renderLink,
  children,
}: {
  places: ReadonlyArray<{ href: string; name: string }>
  renderLink?: RenderLink
  children?: ReactNode
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {places.map((p) => (
        <li key={p.href}>{link(p.href, CHIP, p.name, renderLink)}</li>
      ))}
      {children}
    </ul>
  )
}

/** The page's SEO copy, closed by default. A `<details>`: its content is in the server HTML, open or not. */
export function AboutTimes({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details data-about="" className="group rounded-card bg-white/70 px-4 shadow-card dark:bg-night-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-sm font-bold text-aqua-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ferry-orange dark:text-ferry-aqua-light [&::-webkit-details-marker]:hidden">
        {title}
        <Icon
          name="chevronDown"
          size={18}
          className="shrink-0 group-open:rotate-180 motion-safe:transition-transform"
        />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  )
}
