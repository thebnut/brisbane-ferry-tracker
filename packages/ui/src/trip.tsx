/**
 * Trip detail, one layout for every mode (THE-118 PR 6): the summary card (tile, mode kicker, "To {headsign}", the big
 * countdown and the status line with GPS and the vehicle), the facts row (never an empty tile), the "Your trip"
 * timeline from your stop (earlier stops and stops past your destination collapsed, the train's moving marker), the
 * dock ("Track on map" and the star) and the back link to the place. Only the trip pages load it.
 */
import { type MouseEvent, type ReactNode, useState } from 'react'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'
import { BigCountdown, BOARD_STATE, type StatusLine } from './row.tsx'

// ---------------------------------------------------------------------------
// Back link
// ---------------------------------------------------------------------------

export { BOARD_STATE, boardState } from './row.tsx'

/**
 * The back link's click: back in history when this trip was opened from a board's row (the router keeps the link's
 * state in `history.state.usr`), else the link opens the place's board. A modified click (new tab) is left alone.
 */
export function backClick(e: MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const usr = (globalThis.history?.state as { usr?: Record<string, unknown> } | null)?.usr
  if (typeof usr?.[BOARD_STATE] !== 'string') return
  e.preventDefault()
  history.back()
}

export type TripLinkRenderer = (props: {
  href: string
  className: string
  children: ReactNode
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
}) => ReactNode

/**
 * "‹ Bulimba" above the summary. Inside BrisbaneTransit a phone has it in the app bar already, so `barHasIt` keeps it
 * to desktop there.
 */
export function TripBackLink({
  href,
  label,
  renderLink,
  barHasIt = false,
}: {
  href: string
  label: string
  renderLink: TripLinkRenderer
  barHasIt?: boolean
}) {
  return (
    <div className={cx(barHasIt ? 'hidden md:flex' : 'flex')}>
      {renderLink({
        href,
        onClick: backClick,
        className:
          'flex min-h-11 items-center gap-0.5 rounded-lg pr-2 text-[15px] font-bold text-aqua-text no-underline dark:text-ferry-aqua-light',
        children: (
          <>
            <Icon name="chevronLeft" size={20} />
            <span data-trip-back="">{label}</span>
          </>
        ),
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const TONE: Record<StatusLine['tone'], string> = {
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

export interface TripFact {
  label: string
  value: ReactNode
  sub?: ReactNode
}

export interface TripSummaryProps {
  /** The row's tile: ServiceTile (ferry), PlatformLineTile (train), RouteTile (bus). */
  tile: ReactNode
  /** "Express CityCat", "Metro", "Ferny Grove line". */
  kicker: string
  headsign: string
  /** Whole minutes until it leaves your stop; null when it can't be boarded or has no time. */
  minutes: number | null
  time: string
  dayMarker?: string | null
  /** statusLine() at your stop. */
  status: StatusLine
  /** A live vehicle position is known (GPS). */
  gps?: boolean
  /** The vehicle or vessel, when known: "Mooroolbin II", "Bus 1907". */
  vehicle?: string | null
  /** Up to three facts; a missing one (null) is left out, never shown as "—" (TripFacts). */
  facts?: Array<TripFact | null | false | undefined>
  /** Express: the orange card. */
  hot?: boolean
}

/** The trip's summary card: what you board, where it goes, when it leaves, whether it's live, then the facts. */
export function TripSummary({
  tile,
  kicker,
  headsign,
  minutes,
  time,
  dayMarker,
  status,
  gps = false,
  vehicle,
  facts = [],
  hot = false,
}: TripSummaryProps) {
  const cancelled = status.dot === 'cancelled'
  return (
    <section
      aria-labelledby="trip-title"
      data-trip-summary=""
      className={cx(
        'flex flex-col gap-3 rounded-card p-3.5',
        hot
          ? 'bg-hot border-2 border-ferry-orange shadow-hot'
          : 'border-2 border-transparent bg-white/90 shadow-card dark:bg-night-card',
      )}
    >
      <div className="flex items-center gap-3">
        {tile}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            data-kicker=""
            className="text-[11px] font-bold tracking-[0.12em] text-ferry-orange-deep uppercase dark:text-ferry-sunset"
          >
            {kicker}
          </p>
          <h1
            id="trip-title"
            className={cx(
              'text-[22px] leading-tight font-extrabold text-charcoal [overflow-wrap:anywhere] dark:text-night-text',
              cancelled && 'line-through decoration-2',
            )}
          >
            To {headsign}
          </h1>
        </div>
        {cancelled || minutes == null ? (
          // Nothing to count down to: the clock time alone (struck when cancelled), never a "—".
          time ? (
            <span
              className={cx(
                'shrink-0 text-lg font-bold text-sched-text tabular',
                cancelled && 'line-through',
              )}
            >
              {time}
            </span>
          ) : null
        ) : (
          <BigCountdown minutes={minutes} time={time} dayMarker={dayMarker} size="lg" />
        )}
      </div>
      <p data-trip-status="" className="flex flex-wrap items-center gap-x-1 text-[13px] font-semibold">
        <span
          data-live-claim={status.claim ? '' : undefined}
          className={cx('inline-flex items-center gap-1.5', TONE[status.tone])}
        >
          <span aria-hidden="true" data-dot={status.dot} className={cx('size-2 rounded-full', DOT[status.dot])} />
          {status.text}
        </span>
        {gps ? (
          <span data-live-claim="" className="text-chip-later-text dark:text-green-300">
            <span aria-hidden="true">· </span>GPS
          </span>
        ) : null}
        {vehicle ? (
          <span className="text-sched-text dark:text-night-text/70">
            <span aria-hidden="true">· </span>
            {vehicle}
          </span>
        ) : null}
      </p>
      <TripFacts facts={facts} />
    </section>
  )
}

/** Up to three fact tiles (Departs, Arrives or Journey, Occupancy). A fact with nothing to say is dropped. */
export function TripFacts({ facts }: { facts: Array<TripFact | null | false | undefined> }) {
  const shown = facts.filter((f): f is TripFact => !!f).slice(0, 3)
  if (!shown.length) return null
  return (
    <dl
      data-trip-facts=""
      className={cx('grid gap-2', shown.length === 3 ? 'grid-cols-3' : shown.length === 2 ? 'grid-cols-2' : '')}
    >
      {shown.map((f) => (
        <div
          key={f.label}
          data-fact={f.label}
          className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-white/90 px-2.5 py-2 dark:bg-night-2"
        >
          <dt className="text-[11px] font-semibold text-sched-text dark:text-night-text/70">{f.label}</dt>
          <dd className="text-[15px] font-bold text-charcoal tabular dark:text-night-text">{f.value}</dd>
          {f.sub ? <dd className="text-xs text-sched-text dark:text-night-text/70">{f.sub}</dd> : null}
        </div>
      ))}
    </dl>
  )
}

const OCCUPANCY: Record<string, { text: string; bars: number }> = {
  EMPTY: { text: 'Empty', bars: 0 },
  MANY_SEATS_AVAILABLE: { text: 'Many seats', bars: 1 },
  FEW_SEATS_AVAILABLE: { text: 'Few seats', bars: 2 },
  STANDING_ROOM_ONLY: { text: 'Standing room', bars: 3 },
  CRUSHED_STANDING_ROOM_ONLY: { text: 'Very full', bars: 4 },
  FULL: { text: 'Full', bars: 4 },
  NOT_ACCEPTING_PASSENGERS: { text: 'Not taking passengers', bars: 4 },
}

/** The Occupancy fact, only when the vehicle reports it (GTFS-RT occupancy); otherwise null, so no tile. */
export function occupancyFact(occupancy: string | null | undefined): TripFact | null {
  const o = occupancy ? OCCUPANCY[occupancy] : undefined
  if (!o) return null
  return {
    label: 'Occupancy',
    value: o.text,
    sub: (
      <span role="img" aria-label={`${o.bars} of 4 bars`} className="mt-0.5 flex gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx('h-2 w-3 rounded-[2px]', i < o.bars ? 'bg-ferry-orange-aa' : 'bg-gray-200 dark:bg-night-card')}
          />
        ))}
      </span>
    ),
  }
}

// ---------------------------------------------------------------------------
// Your trip
// ---------------------------------------------------------------------------

export type TimelineKind = 'passed' | 'stop' | 'skip' | 'you' | 'terminus'

export interface TimelineStop {
  id: string
  name: string
  kind: TimelineKind
  /** Second line, e.g. "Platform 3", "Passes, no stop". */
  note?: ReactNode
  /** Arrival and departure, shown separately when they differ. */
  arr?: string | null
  dep?: string | null
  /** e.g. "+3 min" in the late colour. */
  delay?: string | null
  cancelled?: boolean
}

export interface YourTripProps {
  stops: TimelineStop[]
  /** Your stop: the timeline starts here, with the stops before it under "▴ N earlier stops". */
  board: number
  /** Your get-off stop, when known: the stops after it collapse too. */
  alight?: number | null
  /** Line colour, hex without #; aqua by default. */
  color?: string
  /**
   * The vehicle, as a fractional row index (2.4 = 40% of the way from row 2 to row 3), or null when unknown: the orange
   * capsule moving down the line.
   */
  position?: number | null
  /** Its words, e.g. "Between Milton and Auchenflower". */
  positionLabel?: string | null
  /** Under the timeline (the train's "Live updates pushed over a WebSocket"). */
  footer?: ReactNode
}

const lineColourOf = (color?: string) => (color ? `#${color}` : 'var(--color-ferry-aqua)')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function Toggle({
  open,
  count,
  where,
  onClick,
}: {
  open: boolean
  count: number
  where: 'earlier' | 'later'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      data-collapsed={where}
      className="flex min-h-11 items-center gap-1.5 self-start rounded-lg pr-2 pl-1 text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light"
    >
      <span aria-hidden="true">{where === 'earlier' ? (open ? '▾' : '▴') : open ? '▴' : '▾'}</span>{' '}
      {open ? `Hide ${plural(count, `${where} stop`)}` : plural(count, `${where} stop`)}
    </button>
  )
}

/**
 * "Your trip": one timeline for every mode. It starts at your stop; the stops before it, and those past your
 * destination, collapse behind a toggle. Your stop and your get-off stop are bold, stops it runs through are struck
 * through, and the vehicle rides the line as a capsule.
 */
export function YourTrip({
  stops,
  board,
  alight = null,
  color,
  position = null,
  positionLabel,
  footer,
}: YourTripProps) {
  const [earlier, setEarlier] = useState(false)
  const [later, setLater] = useState(false)
  const from = Math.min(Math.max(0, board), Math.max(0, stops.length - 1))
  const to = alight != null && alight > from ? alight : stops.length - 1
  const start = earlier ? 0 : from
  const end = later ? stops.length - 1 : to
  const shown = stops.slice(start, end + 1)
  const c = lineColourOf(color)
  // The capsule on the rows shown; while it's on a collapsed stretch its words say where.
  const rel = position == null ? null : position - start
  const onShown = rel != null && rel >= 0 && rel <= shown.length - 1
  const at = onShown ? Math.floor(rel) : -1
  const frac = onShown ? Math.min(1, rel - at) : 0
  return (
    <section
      aria-labelledby="your-trip"
      data-your-trip=""
      className="flex flex-col rounded-card bg-white/90 px-3.5 py-3 shadow-card dark:bg-night-card"
    >
      <h2 id="your-trip" className="mb-1 text-base font-bold text-aqua-text dark:text-ferry-aqua-light">
        Your trip
      </h2>
      {from > 0 ? (
        <Toggle open={earlier} count={from} where="earlier" onClick={() => setEarlier((v) => !v)} />
      ) : null}
      {positionLabel && !onShown ? (
        <p data-position-label="" className="mb-1 pl-1 text-xs font-semibold text-ferry-orange-deep dark:text-ferry-sunset">
          {positionLabel}
        </p>
      ) : null}
      <ol aria-label="Stops on your trip" className="flex flex-col">
        {shown.map((s, i) => {
          const idx = start + i
          const mine = idx === from || (alight != null && idx === to)
          const passed = s.kind === 'passed'
          const skip = s.kind === 'skip'
          const muted = (passed || skip) && !mine
          const lineCol = passed ? '#C9D7E6' : c
          return (
            <li
              key={s.id}
              data-kind={s.kind}
              data-mine={idx === from ? 'board' : mine ? 'alight' : undefined}
              className="relative flex min-h-12 items-stretch gap-3"
            >
              <span aria-hidden="true" className="relative flex w-6 shrink-0 justify-center">
                <span
                  className="absolute left-1/2 w-1 -translate-x-1/2"
                  style={{
                    background: lineCol,
                    top: idx === 0 ? '50%' : 0,
                    bottom: idx === stops.length - 1 ? '50%' : 0,
                  }}
                />
                <span
                  className={cx(
                    'relative box-border self-center rounded-full',
                    mine
                      ? 'size-5 border-[5px] border-ferry-orange-dark bg-white'
                      : skip
                        ? 'size-3 border-2 bg-white'
                        : 'size-3.5 border-[3px] border-white',
                  )}
                  style={
                    mine ? undefined : skip ? { borderColor: c } : { background: lineCol, boxShadow: `0 0 0 1px ${lineCol}` }
                  }
                />
                {i === at ? (
                  <span
                    data-train-position={position?.toFixed(2)}
                    className="absolute left-1/2 z-10 h-7.5 w-5.5 -translate-x-1/2 -translate-y-1/2 rounded-lg border-[3px] border-white bg-ferry-orange shadow-[0_0_0_2px_#FF6B35,0_0_14px_rgb(255_107_53/0.6)] transition-[top] duration-1000 motion-safe:animate-pulse motion-reduce:transition-none"
                    style={{ top: `calc(50% + ${frac * 100}%)` }}
                  />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col justify-center py-1">
                <span
                  className={cx(
                    'text-[15px]',
                    mine
                      ? 'font-extrabold text-charcoal dark:text-night-text'
                      : muted
                        ? 'font-medium text-sched-text dark:text-night-text/60'
                        : 'font-medium text-charcoal dark:text-night-text',
                    (skip || s.cancelled) && 'line-through',
                  )}
                >
                  {s.name}
                </span>
                {s.note ? <span className="text-xs text-gray-600 dark:text-night-text/70">{s.note}</span> : null}
              </span>
              <span
                className={cx(
                  'flex flex-col items-end justify-center text-sm tabular',
                  mine ? 'font-extrabold' : 'font-semibold',
                  muted ? 'text-sched-text' : 'text-charcoal dark:text-night-text',
                )}
              >
                {s.arr && s.dep && s.arr !== s.dep ? (
                  <>
                    <span className="text-xs font-medium">
                      <span className="sr-only">arrives </span>arr {s.arr}
                    </span>
                    <span>
                      <span className="sr-only">departs </span>dep {s.dep}
                    </span>
                  </>
                ) : s.dep || s.arr ? (
                  <span>{s.dep ?? s.arr}</span>
                ) : null}
                {s.delay ? <span className="text-xs font-semibold text-[#B45309]">{s.delay}</span> : null}
              </span>
            </li>
          )
        })}
        {positionLabel && onShown ? <li className="sr-only">{positionLabel}</li> : null}
      </ol>
      {to < stops.length - 1 ? (
        <Toggle open={later} count={stops.length - 1 - to} where="later" onClick={() => setLater((v) => !v)} />
      ) : null}
      {footer}
    </section>
  )
}

/**
 * The vehicle's place on the timeline from its GPS stop: at the stop when stopped there, otherwise half way from the
 * stop before. Null without a stop it is matched to.
 */
export function positionFromVehicle(
  stopIds: readonly string[],
  vehicle: { stopId?: string; status?: string } | null | undefined,
): number | null {
  const i = vehicle?.stopId ? stopIds.indexOf(vehicle.stopId) : -1
  if (i < 0) return null
  return vehicle?.status === 'STOPPED_AT' || i === 0 ? i : i - 0.5
}

// ---------------------------------------------------------------------------
// Dock and not found
// ---------------------------------------------------------------------------

/** "Track on map" and the star: pinned above the tab bar on phones, inline on desktop. */
export function TripDock({ children }: { children: ReactNode }) {
  return (
    <div
      data-bft-dock=""
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+var(--bft-bottom-bar,64px))] z-20 border-t border-ferry-orange/20 bg-white/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none dark:bg-night-2/95 md:dark:bg-transparent"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-2.5 [&>*]:flex-1">{children}</div>
    </div>
  )
}

/** The dock's "Track on map", as a link (the map page, or the board's map). */
export const trackClass =
  'flex min-h-12 items-center justify-center gap-2 rounded-button bg-ferry-orange-aa px-5 text-base font-bold text-white no-underline shadow-md transition hover:bg-ferry-orange-deep active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100'

/** An expired or unknown trip: a friendly note and the way back to the place's board, never an error page. */
export function TripNotFound({
  place,
  href,
  renderLink,
}: {
  place: string | null
  href: string
  renderLink: TripLinkRenderer
}) {
  return (
    <section
      data-trip-gone=""
      aria-labelledby="trip-gone"
      className="flex flex-col items-start gap-2 rounded-card bg-white/90 px-4 py-6 shadow-card dark:bg-night-card"
    >
      <h1 id="trip-gone" className="text-xl font-extrabold text-charcoal dark:text-night-text">
        This trip has finished
      </h1>
      <p className="text-sm text-sched-text dark:text-night-text/80">
        It may have already run, or the link is from another day. The board has the next departures.
      </p>
      {renderLink({
        href,
        className: trackClass,
        children: place ? `See departures from ${place}` : 'See departures',
      })}
    </section>
  )
}
