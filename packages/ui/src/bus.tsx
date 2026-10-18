/**
 * Bus elements in the ferry look (round 2, B-* boards): huge right-aligned countdown, route departure card,
 * thumb-height search field and sheet, stop result card, "My stops" card, segmented control, trip timeline,
 * occupancy meter, notice strip and skeleton rows.
 */
import { type InputHTMLAttributes, type ReactNode, type Ref, useId } from 'react'
import { StatusBadge } from './board.tsx'
import { cx } from './cx.ts'
import { formatBusCountdown } from './format.ts'
import { Icon } from './icons.tsx'
import { RouteTile, routeTileVariant } from './transit.tsx'

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

export interface BigCountdownProps {
  /** Whole minutes until departure. */
  minutes: number
  /** Clock time under the countdown, e.g. "2:45 pm". */
  time: string
  /** "(19/10)" for tomorrow's departures. */
  dayMarker?: string | null
  cancelled?: boolean
  size?: 'md' | 'lg'
}

/**
 * Huge right-aligned tabular countdown ("Now", "4 min"), orange within 5 minutes; past an hour the clock time is
 * the hero. Cancelled rows show an em dash and strike the clock time.
 */
export function BigCountdown({
  minutes,
  time,
  dayMarker,
  cancelled = false,
  size = 'md',
}: BigCountdownProps) {
  const text = cancelled ? '—' : formatBusCountdown(minutes)
  const soon = !cancelled && minutes <= 5
  const big = size === 'lg' ? 'text-[34px]' : 'text-[30px]'
  return (
    <span className="flex shrink-0 flex-col items-end" data-countdown={cancelled ? 'cancelled' : minutes}>
      {text == null ? (
        // A clock time ("10:45 pm") is twice as wide as a countdown: smaller on phones so the destination keeps room.
        <span
          className={cx(
            size === 'lg' ? 'text-[26px] sm:text-[34px]' : 'text-[24px] sm:text-[30px]',
            'leading-none font-extrabold whitespace-nowrap tabular',
          )}
        >
          {time}
          {dayMarker ? (
            <span className="ml-1 text-sm font-bold text-ferry-orange-deep">{dayMarker}</span>
          ) : null}
        </span>
      ) : (
        <>
          <span
            className={cx(
              big,
              'leading-none font-extrabold tabular',
              cancelled
                ? 'text-gray-400'
                : soon
                  ? 'text-ferry-orange-aa dark:text-ferry-sunset'
                  : 'text-charcoal dark:text-night-text',
            )}
          >
            {cancelled ? (
              <>
                <span aria-hidden="true">{text}</span>
                <span className="sr-only">Cancelled</span>
              </>
            ) : (
              text
            )}
          </span>
          <span
            className={cx(
              'text-xs text-sched-text tabular dark:text-night-text/70',
              cancelled && 'line-through',
            )}
          >
            {time}
            {dayMarker ? <span className="ml-1 font-bold text-ferry-orange-deep">{dayMarker}</span> : null}
          </span>
        </>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Departure card
// ---------------------------------------------------------------------------

export type NoteTone = 'neutral' | 'good' | 'late' | 'info' | 'warning'

const NOTE_TONE: Record<NoteTone, string> = {
  neutral: 'text-sched-text dark:text-night-text/70',
  good: 'text-chip-later-text dark:text-green-300',
  late: 'text-ferry-orange-aa dark:text-ferry-sunset',
  info: 'text-aqua-text dark:text-ferry-aqua-light',
  warning: 'text-orange-800 dark:text-ferry-sunset',
}

export interface RouteDepartureCardProps {
  route: string
  routeLong?: string
  /** Headsign, e.g. "UQ Lakes". */
  destination: string
  status: 'live' | 'scheduled' | 'cancelled' | 'skipped' | 'unknown'
  /** Small note next to the badge: "On time", "+2 min late", "GPS · Few seats". */
  note?: string | null
  noteTone?: NoteTone
  minutes: number
  time: string
  dayMarker?: string | null
  /** Busway platform code, shown as a small chip. */
  platform?: string | null
  highlighted?: boolean
  href?: string
  onSelect?: () => void
  /** Accessible summary for the link/button. */
  label?: string
  /** Rendered by the app's router (React Router Link) when given. */
  renderLink?: (props: { href: string; className: string; children: ReactNode; label?: string }) => ReactNode
}

/** One departure on a stop board (B-Departures): route tile, destination, badge + note, big countdown. */
export function RouteDepartureCard({
  route,
  routeLong,
  destination,
  status,
  note,
  noteTone = 'neutral',
  minutes,
  time,
  dayMarker,
  platform,
  highlighted = false,
  href,
  onSelect,
  label,
  renderLink,
}: RouteDepartureCardProps) {
  const cancelled = status === 'cancelled'
  const className = cx(
    'flex min-h-[76px] w-full items-center gap-3 rounded-card px-3.5 py-2.5 text-left no-underline transition md:min-h-24 md:px-5',
    highlighted
      ? 'bg-hot border-2 border-ferry-orange shadow-hot'
      : 'border-2 border-transparent bg-white/90 shadow-card hover:border-ferry-orange/40 dark:bg-night-card',
    cancelled && 'opacity-90',
  )
  const children = (
    <>
      <RouteTile route={route} variant={routeTileVariant(route, routeLong)} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Up to two lines before an ellipsis: a long headsign mustn't be cut to a few letters on a phone (B2). */}
        <span
          data-testid="destination"
          className={cx(
            'line-clamp-2 text-base leading-snug font-bold break-words text-charcoal md:text-lg dark:text-night-text',
            cancelled && 'line-through decoration-2',
          )}
        >
          {destination}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge kind={status} />
          {platform ? (
            <span className="rounded-full bg-ferry-light-blue px-2 py-0.5 text-[11px] font-bold text-aqua-text dark:bg-night-2 dark:text-ferry-aqua-light">
              Platform {platform}
            </span>
          ) : null}
          {note ? <span className={cx('text-xs font-semibold', NOTE_TONE[noteTone])}>{note}</span> : null}
        </span>
      </span>
      <BigCountdown minutes={minutes} time={time} dayMarker={dayMarker} cancelled={cancelled} />
    </>
  )
  const attrs = { 'data-highlighted': highlighted || undefined, 'data-status': status }
  if (href) {
    return (
      <div {...attrs} data-testid="departure">
        {renderLink ? (
          renderLink({ href, className, children, label })
        ) : (
          <a href={href} className={className} aria-label={label}>
            {children}
          </a>
        )}
      </div>
    )
  }
  if (onSelect) {
    return (
      <div {...attrs} data-testid="departure">
        <button type="button" onClick={onSelect} className={className} aria-label={label}>
          {children}
        </button>
      </div>
    )
  }
  return (
    <div {...attrs} data-testid="departure" className={className}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  /** Visually hide the label (desktop header). */
  hideLabel?: boolean
  onClear?: () => void
  inputRef?: Ref<HTMLInputElement>
  compact?: boolean
}

/** The orange-bordered "Stop name or number" field (B-Home, B-Search, B-Desktop). */
export function SearchField({
  label,
  hideLabel = false,
  onClear,
  inputRef,
  compact = false,
  id,
  className,
  value,
  ...rest
}: SearchFieldProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={inputId}
        className={cx('text-[13px] font-bold text-charcoal dark:text-night-text', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div
        className={cx(
          'flex items-center gap-2.5 rounded-card border-2 border-ferry-orange bg-white pr-1.5 pl-3 shadow-[0_0_12px_rgb(255_107_53/0.25)] dark:bg-night-2',
          compact ? 'h-[46px]' : 'h-[52px]',
        )}
      >
        <Icon name="search" size={20} className="shrink-0 text-ferry-orange-dark" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={value}
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-charcoal outline-none placeholder:text-gray-500 dark:text-night-text [&::-webkit-search-cancel-button]:hidden"
          {...rest}
        />
        {onClear && value ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sched-bg text-sched-text dark:bg-night-card"
          >
            <Icon name="close" size={18} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export interface ThumbSheetProps {
  label: string
  children: ReactNode
  className?: string
  /** Show the grab handle (decorative). */
  handle?: boolean
}

/** Static bottom panel at thumb height (B-Home "Find a stop", B-Search, B-Map bus list). */
export function ThumbSheet({ label, children, className, handle = true }: ThumbSheetProps) {
  return (
    <section
      aria-label={label}
      className={cx(
        'rounded-t-[22px] border-t border-ferry-orange/20 bg-white/97 px-4 pt-2 shadow-[0_-8px_24px_rgb(0_0_0/0.1)] backdrop-blur dark:bg-night-2/97',
        className,
      )}
    >
      {handle ? (
        <span aria-hidden="true" className="mx-auto mb-2 block h-[5px] w-10 rounded-full bg-gray-300" />
      ) : null}
      {children}
    </section>
  )
}

export interface StopResultCardProps {
  name: string
  /** "Stop 010802 · busway platform". */
  meta?: string
  /** Busway platform code shown in the tile, else a pin. */
  platform?: string | null
  routes: string[]
  /** Show at most this many route chips, then "+n". */
  maxRoutes?: number
  distance?: string | null
  best?: boolean
  href: string
  renderLink?: RouteDepartureCardProps['renderLink']
}

/** One search or nearby result (B-Search): platform tile, name, stop number, route chips, distance. */
export function StopResultCard({
  name,
  meta,
  platform,
  routes,
  maxRoutes = 5,
  distance,
  best = false,
  href,
  renderLink,
}: StopResultCardProps) {
  const shown = routes.slice(0, maxRoutes)
  const more = routes.length - shown.length
  const className = cx(
    'flex min-h-[72px] items-center gap-3 rounded-card px-3.5 py-3 no-underline',
    best
      ? 'bg-hot border-2 border-ferry-orange shadow-[0_0_18px_rgb(255_107_53/0.35)]'
      : 'border-2 border-transparent bg-white/90 shadow-card dark:bg-night-card',
  )
  const children = (
    <>
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 flex-col items-center justify-center rounded-card bg-ferry-light-blue leading-none text-aqua-text dark:bg-night-2 dark:text-ferry-aqua-light"
      >
        {platform ? (
          <>
            <span className="text-[9px] font-bold">PLAT</span>
            <span className="text-[19px] font-extrabold">{platform}</span>
          </>
        ) : (
          <Icon name="bus" size={22} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold text-charcoal dark:text-night-text">{name}</span>
        {meta ? <span className="text-xs text-sched-text dark:text-night-text/70">{meta}</span> : null}
        {shown.length ? (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {shown.map((r) => (
              <RouteTile key={r} route={r} variant={routeTileVariant(r)} size="sm" />
            ))}
            {more > 0 ? (
              <span className="flex h-6 items-center rounded-md bg-teal-text px-1.5 text-xs font-extrabold text-white">
                +{more}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      {distance ? (
        <span className="shrink-0 text-[13px] font-bold whitespace-nowrap text-ferry-orange-aa dark:text-ferry-sunset">
          {distance}
        </span>
      ) : null}
    </>
  )
  return (
    <li data-testid="stop-result" data-best={best || undefined}>
      {renderLink ? (
        renderLink({ href, className, children })
      ) : (
        <a href={href} className={className}>
          {children}
        </a>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// My stops
// ---------------------------------------------------------------------------

export interface MiniDeparture {
  key: string
  route: string
  routeLong?: string
  destination: string
  /** "LIVE · on time", "SCHEDULED". */
  status: string
  live: boolean
  minutes: number
  time: string
}

export interface MyStopCardProps {
  name: string
  meta?: string
  href: string
  departures: MiniDeparture[]
  highlighted?: boolean
  /** Shown when there are no departures (loading, none tonight, offline). */
  empty?: ReactNode
  renderLink?: RouteDepartureCardProps['renderLink']
}

/** A saved stop with its next 3 routes (B-Home). */
export function MyStopCard({
  name,
  meta,
  href,
  departures,
  highlighted,
  empty,
  renderLink,
}: MyStopCardProps) {
  const heading = (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-[15px] font-bold text-aqua-text dark:text-ferry-aqua-light">{name}</span>
      {meta ? <span className="text-xs whitespace-nowrap text-sched-text">{meta}</span> : null}
    </span>
  )
  const linkClass = 'block rounded-button no-underline'
  return (
    <section
      data-testid="my-stop"
      className={cx(
        'rounded-card px-3.5 pt-3 pb-1.5',
        highlighted
          ? 'bg-hot border-2 border-ferry-orange shadow-[0_0_20px_rgb(255_107_53/0.35)]'
          : 'bg-white/90 shadow-card dark:bg-night-card',
      )}
    >
      <h2 className="mb-2">
        {renderLink ? (
          renderLink({ href, className: linkClass, children: heading })
        ) : (
          <a href={href} className={linkClass}>
            {heading}
          </a>
        )}
      </h2>
      {departures.length === 0 ? (
        <div className="border-t border-charcoal/5 py-2 text-sm text-sched-text">{empty}</div>
      ) : (
        <ul>
          {departures.map((d) => (
            <li key={d.key} className="flex items-center gap-2.5 border-t border-charcoal/5 py-1.5">
              <RouteTile route={d.route} variant={routeTileVariant(d.route, d.routeLong)} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{d.destination}</span>
                <span
                  data-live-claim={d.live ? '' : undefined}
                  className={cx(
                    'text-xs font-semibold',
                    d.live ? 'text-ferry-orange-aa dark:text-ferry-sunset' : 'text-sched-text',
                  )}
                >
                  {d.status}
                </span>
              </span>
              <MiniChip minutes={d.minutes} time={d.time} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MiniChip({ minutes, time }: { minutes: number; time: string }) {
  const text = formatBusCountdown(minutes)
  const tone =
    minutes < 1
      ? 'bg-departing text-white'
      : minutes <= 5
        ? 'bg-ferry-orange-aa text-white'
        : minutes <= 15
          ? 'bg-ferry-sunset text-charcoal'
          : 'border border-chip-later-border bg-chip-later-bg text-chip-later-text'
  return (
    <span className={cx('rounded-full px-3 py-1.5 text-lg font-extrabold whitespace-nowrap tabular', tone)}>
      {text ?? time}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

export interface SegmentedControlProps<T extends string> {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}

/** Two or three pressed-state pills in a white track ("My stops | All routes", "Route 66 | My stop"). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, as in the design.
    <div
      role="group"
      aria-label={label}
      className="flex rounded-full border border-ferry-orange/20 bg-white/90 p-[3px] dark:bg-night-card"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-9 rounded-full px-3 text-[13px]',
              on
                ? 'bg-ferry-orange-aa font-bold text-white'
                : 'font-semibold text-aqua-text dark:text-ferry-aqua-light',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export interface SaveButtonProps {
  saved: boolean
  onToggle: () => void
  name: string
}

/** Star toggle for "My stops". */
export function SaveButton({ saved, onToggle, name }: SaveButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from My stops` : `Save ${name} to My stops`}
      className={cx(
        'flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-95',
        saved
          ? 'bg-ferry-orange-light text-ferry-orange-dark'
          : 'border border-ferry-orange/25 bg-white text-aqua-text dark:bg-night-card',
      )}
    >
      <Icon name="star" size={22} fill={saved ? 'currentColor' : 'none'} />
    </button>
  )
}

export interface NoticeStripProps {
  children: ReactNode
  href?: string
  renderLink?: RouteDepartureCardProps['renderLink']
}

/** Amber detour/alert strip linking to /alerts (B-Departures). */
export function NoticeStrip({ children, href, renderLink }: NoticeStripProps) {
  const className =
    'flex items-center gap-2.5 rounded-card border border-orange-300 bg-orange-50 px-3 py-2.5 text-[13px] font-semibold text-orange-800 no-underline dark:border-ferry-sunset/40 dark:bg-night-card dark:text-ferry-sunset'
  const body = (
    <>
      <Icon name="alert" size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {href ? <span aria-hidden="true">›</span> : null}
    </>
  )
  if (!href) return <div className={className}>{body}</div>
  return renderLink ? (
    renderLink({ href, className, children: body })
  ) : (
    <a href={href} className={className}>
      {body}
    </a>
  )
}

const OCC: Record<string, { bars: number; text: string }> = {
  EMPTY: { bars: 0, text: 'Empty' },
  MANY_SEATS_AVAILABLE: { bars: 1, text: 'Many seats' },
  FEW_SEATS_AVAILABLE: { bars: 3, text: 'Few seats' },
  STANDING_ROOM_ONLY: { bars: 4, text: 'Standing room' },
  CRUSHED_STANDING_ROOM_ONLY: { bars: 4, text: 'Very full' },
  FULL: { bars: 4, text: 'Full' },
  NOT_ACCEPTING_PASSENGERS: { bars: 4, text: 'Not taking passengers' },
}

/** GTFS-RT occupancy as a short label ("Few seats"), or null. */
export function occupancyText(occupancy: string | null | undefined): string | null {
  return occupancy ? (OCC[occupancy]?.text ?? null) : null
}

export function OccupancyMeter({ occupancy }: { occupancy: string | null | undefined }) {
  const o = occupancy ? OCC[occupancy] : undefined
  if (!o) return <span className="text-[13px] font-bold">Not reported</span>
  return (
    <>
      <span className="flex gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx('h-2 w-3.5 rounded-[2px]', i < o.bars ? 'bg-ferry-orange-dark' : 'bg-gray-200')}
          />
        ))}
      </span>
      <span className="text-[13px] font-bold">{o.text}</span>
    </>
  )
}

// ---------------------------------------------------------------------------
// Trip timeline
// ---------------------------------------------------------------------------

export type BusTimelineKind = 'past' | 'here' | 'next' | 'end'

export interface BusTimelineStop {
  key: string
  name: string
  meta?: string
  time: string
  kind: BusTimelineKind
  /** "not stopping" etc. */
  struck?: boolean
}

/** Vertical stopping pattern with the bus as a ringed orange dot (B-Detail "Stops on this trip"). */
export function TripTimeline({
  stops,
  label = 'Stops on this trip',
}: {
  stops: BusTimelineStop[]
  label?: string
}) {
  return (
    <ol aria-label={label}>
      {stops.map((s) => {
        const past = s.kind === 'past'
        return (
          <li key={s.key} data-kind={s.kind} className="flex min-h-11 items-stretch gap-3">
            <span aria-hidden="true" className="relative flex w-7 shrink-0 justify-center">
              <span
                className={cx(
                  'absolute inset-y-0 left-3 w-1 rounded-sm',
                  past ? 'bg-gray-300' : 'bg-teal-text',
                )}
              />
              <span
                className={cx(
                  'relative box-border',
                  s.kind === 'past' && 'mt-[15px] size-3 rounded-full border-2 border-white bg-gray-300',
                  s.kind === 'here' &&
                    'mt-2 size-6 rounded-full border-[3px] border-white bg-ferry-orange shadow-[0_0_0_4px_rgb(255_107_53/0.3)]',
                  s.kind === 'next' && 'mt-3.5 size-3.5 rounded-full border-[3px] border-teal-text bg-white',
                  s.kind === 'end' && 'mt-[13px] size-4 rounded-[4px] border-2 border-white bg-teal-text',
                )}
              />
            </span>
            <span className="flex flex-1 items-center justify-between gap-2 border-b border-charcoal/5">
              <span className="flex flex-col">
                <span
                  className={cx(
                    'text-[15px]',
                    s.kind === 'here' || s.kind === 'end' ? 'font-extrabold' : 'font-semibold',
                    past ? 'text-gray-500' : 'text-charcoal dark:text-night-text',
                    s.struck && 'line-through',
                  )}
                >
                  {s.name}
                </span>
                {s.meta ? <span className="text-xs text-sched-text">{s.meta}</span> : null}
              </span>
              <span
                className={cx(
                  'text-[15px] font-bold whitespace-nowrap tabular',
                  past ? 'text-gray-500' : 'text-charcoal dark:text-night-text',
                )}
              >
                {s.time}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Placeholder departure rows (B-States "Loading"). */
export function SkeletonRows({
  count = 5,
  label = 'Getting live buses…',
}: {
  count?: number
  label?: string
}) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-live="polite">
      <p className="flex items-center gap-2.5 text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light">
        <span className="box-border size-5 rounded-full border-[3px] border-ferry-orange-light border-t-ferry-orange motion-safe:animate-spin" />
        {label}
      </p>
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
          key={i}
          aria-hidden="true"
          className="flex min-h-[76px] items-center gap-3 rounded-card bg-white/90 px-3.5 shadow-card dark:bg-night-card"
        >
          <span className="h-13 w-15 rounded-card bg-gray-200 dark:bg-night-2" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-[70%] rounded-md bg-gray-200 dark:bg-night-2" />
            <span className="h-2.5 w-[40%] rounded-md bg-gray-100 dark:bg-night-2" />
          </span>
          <span className="h-7 w-14 rounded-button bg-ferry-orange-light dark:bg-night-2" />
        </div>
      ))}
    </div>
  )
}
