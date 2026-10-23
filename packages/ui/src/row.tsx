/**
 * One departure row for every board (THE-118 PR 4): a 52 px tile, the destination, a status line (a dot, one word
 * and one mode fact), the big countdown with the clock under it, and an extra column on wide boards. Also the row
 * rules the boards share: the status-line words, the soonest boardable row, the "Tomorrow" divider and tile text
 * colour on a line colour.
 */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'
import { brisbaneDateKey, formatBusCountdown, formatDay, minutesBetween } from './format.ts'

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RowStatus = 'live' | 'scheduled' | 'cancelled' | 'skipped' | 'unknown'
export type RowTone = 'good' | 'late' | 'early' | 'neutral' | 'bad'

export interface StatusLineInput {
  status: RowStatus
  /** Timetabled and live departure, epoch s: a live row says on time, late or early from the clocks shown. */
  schedDep?: number
  estDep?: number | null
  /** A cancelled row: the next service like it that you can board ("next 60 in 15 min"). */
  next?: { name: string; minutes: number } | null
  /** A live platform change: the timetabled platform ("platform changed from 5"). It is then the row's fact. */
  platformFrom?: string | null
}

export interface StatusLine {
  /** Green dot for live, grey for scheduled, red for cancelled or not stopping. */
  dot: 'live' | 'scheduled' | 'cancelled'
  text: string
  tone: RowTone
  /** Live words: hidden with the LIVE pill while a cached page is unconfirmed (data-live-claim). */
  claim: boolean
}

/** The status line's words: "Live · 2 min late", "Scheduled", "Cancelled · next 60 in 15 min", "Not stopping here". */
export function statusLine({ status, schedDep, estDep, next, platformFrom }: StatusLineInput): StatusLine {
  if (status === 'cancelled')
    return {
      dot: 'cancelled',
      text: next ? `Cancelled · next ${next.name} in ${Math.max(0, next.minutes)} min` : 'Cancelled',
      tone: 'bad',
      claim: false,
    }
  if (status === 'skipped') return { dot: 'cancelled', text: 'Not stopping here', tone: 'bad', claim: false }
  if (status !== 'live')
    return {
      dot: 'scheduled',
      text: status === 'unknown' ? 'Status unknown' : 'Scheduled',
      tone: 'neutral',
      claim: false,
    }
  // Without the timetabled time (an Ask answer row) a live row only says "Live".
  const d = schedDep == null ? null : estDep == null ? 0 : minutesBetween(schedDep, estDep)
  const when =
    d == null
      ? null
      : d >= 1
        ? `${d} min late`
        : d <= -1
          ? `${-d} min early`
          : platformFrom
            ? null
            : 'on time'
  return {
    dot: 'live',
    text: ['Live', when, platformFrom ? `platform changed from ${platformFrom}` : null]
      .filter(Boolean)
      .join(' · '),
    tone: d == null ? 'good' : d >= 1 ? 'late' : d <= -1 ? 'early' : 'good',
    claim: true,
  }
}

const boardable = (s: string) => s !== 'cancelled' && s !== 'skipped'

/** The soonest row a rider can board (not cancelled, not skipped): it gets the orange border. -1 when none. */
export const soonestIndex = (rows: ReadonlyArray<{ status: string }>) =>
  rows.findIndex((r) => boardable(r.status))

/** The first boardable row after `i` that `same` matches (a cancelled row's "next 60"). */
export function nextAlike<T extends { status: string }>(
  rows: readonly T[],
  i: number,
  same: (r: T) => boolean,
): T | undefined {
  return rows.slice(i + 1).find((r) => boardable(r.status) && same(r))
}

/**
 * The divider above each row that starts a later Brisbane day than now: "Tomorrow · Fri 23 Oct", then "Sat 24 Oct".
 * One label per row (null for no divider), from the rows' departure times in the order shown.
 */
export function dayDividers(depS: readonly number[], nowMs: number): Array<string | null> {
  const today = brisbaneDateKey(nowMs)
  const tomorrow = brisbaneDateKey(nowMs + 86_400_000)
  let last = today
  return depS.map((s) => {
    const key = brisbaneDateKey(s * 1000)
    if (key <= last) return null
    last = key
    return key === tomorrow ? `Tomorrow · ${formatDay(s)}` : formatDay(s)
  })
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

export interface BigCountdownProps {
  /** Whole minutes until departure. */
  minutes: number
  /** Clock time under the countdown, e.g. "2:45 pm". */
  time: string
  /** "(19/10)" for tomorrow's departures (trip detail; boards use the Tomorrow divider). */
  dayMarker?: string | null
  cancelled?: boolean
  size?: 'md' | 'lg'
}

/** "in 1 hr 29", "in 4 hr": under the clock time once a departure is over an hour away. */
export function hoursAway(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `in ${h} hr${m ? ` ${m}` : ''}`
}

/**
 * Huge right-aligned tabular countdown ("Now", "4 min"), orange within 5 minutes; past an hour the clock time is
 * the hero, with "in 1 hr 29" under it. A row you can't board (cancelled, not stopping) shows an em dash, hidden from
 * screen readers (the status line says why), and strikes the clock time.
 */
export function BigCountdown({
  minutes,
  time,
  dayMarker,
  cancelled = false,
  size = 'md',
}: BigCountdownProps) {
  const text = cancelled ? '—' : formatBusCountdown(minutes)
  // Over an hour: the clock time is the big figure. It is twice as wide as a countdown, so smaller on phones to leave
  // the destination room for two full lines (B2).
  const clock = text == null
  const lg = size === 'lg'
  return (
    <span className="flex shrink-0 flex-col items-end" data-countdown={cancelled ? 'cancelled' : minutes}>
      <span
        aria-hidden={cancelled || undefined}
        className={cx(
          'leading-none font-extrabold whitespace-nowrap tabular',
          clock
            ? lg
              ? 'text-[26px] sm:text-[34px]'
              : 'text-[20px] min-[421px]:text-[24px] sm:text-[30px]'
            : lg
              ? 'text-[34px]'
              : 'text-[26px] min-[421px]:text-[30px]',
          cancelled
            ? 'text-gray-400'
            : !clock && minutes <= 5
              ? 'text-ferry-orange-aa dark:text-ferry-sunset'
              : 'text-charcoal dark:text-night-text',
        )}
      >
        {text ?? time}
      </span>
      <span
        className={cx('text-xs text-sched-text tabular dark:text-night-text/70', cancelled && 'line-through')}
      >
        {clock ? hoursAway(minutes) : time}
        {dayMarker ? <span className="ml-1 font-bold text-ferry-orange-deep">{dayMarker}</span> : null}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

const TONE: Record<RowTone, string> = {
  good: 'text-chip-later-text dark:text-green-300',
  late: 'text-ferry-orange-aa dark:text-ferry-sunset',
  early: 'text-aqua-text dark:text-ferry-aqua-light',
  neutral: 'text-sched-text dark:text-night-text/70',
  bad: 'text-cancel-text dark:text-red-300',
}

const DOT: Record<StatusLine['dot'], string> = {
  live: 'bg-green-600',
  scheduled: 'bg-gray-400',
  cancelled: 'bg-red-600',
}

export type LinkRenderer = (props: {
  href: string
  className: string
  children: ReactNode
  label?: string
}) => ReactNode

export interface DepartureRowProps {
  /** The 52 px tile: RouteTile (bus), PlatformLineTile (train), ServiceTile (ferry). */
  tile: ReactNode
  /** Headsign, e.g. "UQ Lakes". */
  destination: string
  /** statusLine() */
  status: StatusLine & { status: RowStatus }
  /** One mode fact after the status: the line, "arr 7:31", "GPS", "detour". */
  fact?: string | null
  /** The fact on a wide row, where `extra` carries the arrival (e.g. the line name instead of "arr 7:31"). */
  wideFact?: string | null
  /** Wide rows only: arrival and journey, or occupancy. Hidden on phones. */
  extra?: ReactNode
  /** Whole minutes until departure; null (or a cancelled or skipped status) shows no countdown. */
  minutes: number | null
  time: string
  highlighted?: boolean
  /** A link to the trip, rendered by `renderLink` (the app's router Link). */
  href?: string
  renderLink?: LinkRenderer
  onSelect?: () => void
  /**
   * An accessible name for the link or button, overriding its content. Boards leave it out: the content's name
   * leaves out the live words while the live guard hides them, a label would not (Codex r2).
   */
  label?: string
}

/** One departure on any board: tile, destination, status line, big countdown (B-Departures, THE-118 §1). */
export function DepartureRow({
  tile,
  destination,
  status,
  fact,
  wideFact = fact,
  extra,
  minutes,
  time,
  highlighted = false,
  href,
  onSelect,
  label,
  renderLink,
}: DepartureRowProps) {
  const cancelled = status.status === 'cancelled'
  // A service you can't board never counts down, whatever minutes the board passed (Codex r1).
  const blocked = cancelled || status.status === 'skipped'
  const shownFact = (f: string | null | undefined, cls?: string) =>
    f ? <span className={cx('text-sched-text dark:text-night-text/70', cls)}>{f}</span> : null
  const className = cx(
    'flex min-h-[76px] w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left text-inherit no-underline transition min-[421px]:gap-3 min-[421px]:px-3.5 md:min-h-24 md:px-5',
    highlighted
      ? 'bg-hot border-2 border-ferry-orange shadow-hot'
      : 'border-2 border-transparent bg-white/90 shadow-card hover:border-ferry-orange/40 dark:bg-night-card',
    blocked && 'opacity-90',
  )
  const children = (
    <>
      {tile}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Two lines (three on a narrow phone beside a wide countdown) before an ellipsis: a long headsign must never
            be cut on a phone (B2). */}
        <span
          data-testid="destination"
          className={cx(
            'line-clamp-3 text-[15px] leading-snug font-bold break-words text-charcoal min-[421px]:line-clamp-2 min-[421px]:text-base md:text-lg dark:text-night-text',
            cancelled && 'line-through decoration-2',
          )}
        >
          {destination}
        </span>
        <span data-row-status="" className="flex flex-wrap items-center gap-x-1 text-xs font-semibold">
          <span
            data-live-claim={status.claim ? '' : undefined}
            className={cx('inline-flex items-center gap-1.5', TONE[status.tone])}
          >
            <span
              aria-hidden="true"
              data-dot={status.dot}
              className={cx('size-2 rounded-full', DOT[status.dot])}
            />
            {status.text}
            {(extra ? fact || wideFact : fact) ? (
              // With an extra column the phone and wide facts differ: the dot shows only where a fact does.
              <span
                aria-hidden="true"
                className={cx(!!extra && !fact && 'hidden @lg:inline', !!extra && !wideFact && '@lg:hidden')}
              >
                ·
              </span>
            ) : null}
          </span>
          {extra ? (
            <>
              {shownFact(fact, '@lg:hidden')}
              {shownFact(wideFact, 'hidden @lg:inline')}
            </>
          ) : (
            shownFact(fact)
          )}
        </span>
      </span>
      {extra ? (
        <span
          data-extra=""
          className="hidden shrink-0 flex-col items-end text-right text-[13px] font-semibold text-sched-text @lg:flex dark:text-night-text/70"
        >
          {extra}
        </span>
      ) : null}
      <BigCountdown minutes={minutes ?? 0} time={time} cancelled={blocked || minutes == null} />
    </>
  )
  return (
    <div
      data-testid="departure"
      data-highlighted={highlighted || undefined}
      data-status={status.status}
      className="@container"
    >
      {href && renderLink ? (
        renderLink({ href, className, children, label })
      ) : onSelect ? (
        <button type="button" onClick={onSelect} className={className} aria-label={label}>
          {children}
        </button>
      ) : (
        <div className={className}>{children}</div>
      )}
    </div>
  )
}

/** "Tomorrow · Fri 23 Oct" above the first of the next day's rows (replaces the per-time "(23/10)" tags). */
export function DayDivider({ children }: { children: ReactNode }) {
  return (
    <p
      data-day-divider=""
      className="mt-1 mb-2.5 px-1 text-sm font-extrabold text-ferry-orange-deep dark:text-ferry-sunset"
    >
      {children}
    </p>
  )
}
