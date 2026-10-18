/** Departure board building blocks: board header, departure card, countdown chip, status badges and buttons. */
import type { ButtonHTMLAttributes, ElementType, ReactNode } from 'react'
import { cx } from './cx.ts'
import { type CountdownTone, countdownTone, formatCountdown } from './format.ts'
import { Icon } from './icons.tsx'

// ---------------------------------------------------------------------------
// Countdown chip
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<CountdownTone, string> = {
  departing: 'bg-departing text-white motion-safe:animate-pulse',
  soon: 'bg-ferry-orange-aa text-white',
  near: 'bg-ferry-sunset text-charcoal',
  later: 'bg-chip-later-bg text-chip-later-text border border-chip-later-border',
}

export interface CountdownChipProps {
  /** Whole minutes until departure (see minutesUntil). */
  minutes: number
  className?: string
}

/** Countdown chip with the ferry colour bands. Renders nothing for departures more than an hour away. */
export function CountdownChip({ minutes, className }: CountdownChipProps) {
  const text = formatCountdown(minutes)
  if (text == null) return null
  const tone = countdownTone(minutes)
  return (
    <span
      data-tone={tone}
      className={cx(
        'inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-base font-extrabold whitespace-nowrap tabular',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

export type BadgeKind = 'live' | 'scheduled' | 'gps' | 'express' | 'cancelled' | 'skipped' | 'unknown'

const BADGE: Record<BadgeKind, { label: string; className: string }> = {
  live: { label: 'LIVE', className: 'bg-ferry-orange-aa text-white font-bold' },
  scheduled: { label: 'SCHEDULED', className: 'bg-sched-bg text-sched-text font-semibold' },
  gps: { label: 'GPS', className: 'bg-aqua-text text-white font-bold' },
  express: { label: 'EXPRESS', className: 'text-ferry-orange-deep font-extrabold tracking-wide px-0' },
  cancelled: { label: 'CANCELLED', className: 'bg-cancel-bg text-cancel-text font-extrabold' },
  skipped: { label: 'SKIPPED', className: 'bg-cancel-bg text-cancel-text font-bold' },
  unknown: { label: 'UNKNOWN', className: 'bg-sched-bg text-sched-text font-semibold' },
}

export interface StatusBadgeProps {
  kind: BadgeKind
  /** Override the visible text (e.g. "EXPRESS · F11"). */
  children?: ReactNode
}

export function StatusBadge({ kind, children }: StatusBadgeProps) {
  const b = BADGE[kind]
  return (
    <span
      data-badge={kind}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] leading-5',
        b.className,
      )}
    >
      {kind === 'gps' ? <Icon name="pin" size={12} /> : null}
      {kind === 'express' ? <Icon name="ferry" size={14} /> : null}
      {children ?? b.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Board header
// ---------------------------------------------------------------------------

export interface BoardHeaderProps {
  /** Title or the from/to controls, e.g. "Bulimba → Riverside" or two StopSelects. */
  children: ReactNode
  onSwap?: () => void
  trailing?: ReactNode
  as?: 'h2' | 'div'
}

export function BoardHeader({ children, onSwap, trailing, as: Tag = 'div' }: BoardHeaderProps) {
  return (
    // Wraps: when the title (at least 12rem) and the trailing control don't fit side by side on a narrow phone, the
    // control drops to its own line rather than pushing the page wider.
    <div className="bg-board-header flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-card border border-ferry-orange/10 px-3.5 py-2 shadow-sm">
      <Tag className="flex min-w-0 grow basis-48 items-center gap-2 text-base font-semibold text-aqua-text dark:text-ferry-aqua-light">
        {children}
      </Tag>
      {trailing}
      {onSwap ? (
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap direction"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-ferry-orange/25 bg-white text-ferry-orange-dark transition active:scale-95 dark:bg-night-card"
        >
          <Icon name="swap" size={18} />
        </button>
      ) : null}
    </div>
  )
}

export interface StopSelectProps {
  value: string
  options: Array<{ id: string; name: string }>
  onChange: (id: string) => void
  label: string
  disabled?: boolean
}

/** Native select styled for board headers (fast, accessible, works before hydration). */
export function StopSelect({ value, options, onChange, label, disabled }: StopSelectProps) {
  return (
    <label className="relative min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 cursor-pointer appearance-none truncate rounded-button border border-gray-300 bg-white py-2 pr-7 pl-2.5 text-sm font-semibold text-aqua-text hover:border-ferry-orange focus:border-ferry-orange disabled:opacity-50 md:text-base dark:border-night-card dark:bg-night-card dark:text-ferry-aqua-light"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        size={16}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ferry-orange"
      />
    </label>
  )
}

// ---------------------------------------------------------------------------
// Departure card
// ---------------------------------------------------------------------------

export interface DepartureCardProps {
  /** Clock time of departure, e.g. "7:42 pm". */
  time: string
  /** "(19/10)" next-day marker. */
  dayMarker?: string | null
  arrival?: { time: string; dayMarker?: string | null } | null
  /** e.g. "12 min" journey suffix. */
  journey?: string | null
  badges?: BadgeKind[]
  /** Service label, e.g. "EXPRESS · F11" or "ALL STOPS · F1". */
  service?: string
  express?: boolean
  /** Status line, e.g. "Mooroolbin II · Sched Dept 7:42 pm". */
  note?: string | null
  /** Right-side late/early text. */
  delay?: string | null
  minutes?: number | null
  /** The next/express highlighted variant (orange border and glow). */
  highlighted?: boolean
  cancelled?: boolean
  /** Platform tile or route tile on the left. */
  leading?: ReactNode
  /** Stopping pattern strip below the main row. */
  below?: ReactNode
  onSelect?: () => void
  /** Make the card a link instead of a button (e.g. to a service detail page); works before hydration. */
  href?: string
  /** Link component for `href`, e.g. React Router's Link (receives `to` and `href`). Defaults to <a>. */
  linkAs?: ElementType
  /** Accessible summary for the whole card button. */
  label?: string
}

export function DepartureCard({
  time,
  dayMarker,
  arrival,
  journey,
  badges = [],
  service,
  express = false,
  note,
  delay,
  minutes,
  highlighted = false,
  cancelled = false,
  leading,
  below,
  onSelect,
  href,
  linkAs: LinkAs = 'a',
  label,
}: DepartureCardProps) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-1.5">
            {badges.map((b) => (
              <StatusBadge key={b} kind={b} />
            ))}
            {service ? (
              <span
                className={cx(
                  'text-[11px] font-extrabold tracking-wide',
                  express
                    ? 'text-ferry-orange-deep dark:text-ferry-sunset'
                    : 'text-sched-text dark:text-night-text/70',
                )}
              >
                {service}
              </span>
            ) : null}
          </span>
          {/* Departure and arrival are separate unbreakable chunks: on a narrow card the arrival wraps to its own
              line instead of running under the countdown chip. */}
          <span
            data-testid="times"
            className={cx(
              'flex flex-wrap items-baseline gap-x-1.5 font-extrabold tabular',
              express ? 'text-[22px]' : 'text-xl',
            )}
          >
            <span className={cx('whitespace-nowrap', cancelled && 'line-through decoration-2')}>
              {time}
              {dayMarker ? (
                <span className="ml-1 text-sm font-medium text-ferry-orange-deep">{dayMarker}</span>
              ) : null}
            </span>
            {arrival ? (
              <span className={cx('whitespace-nowrap', cancelled && 'line-through decoration-2')}>
                <span className="mr-1.5 font-normal text-gray-500" aria-hidden="true">
                  →
                </span>
                <span className="sr-only"> arriving </span>
                <span className="font-medium text-gray-700 dark:text-night-text/80">{arrival.time}</span>
                {arrival.dayMarker ? (
                  <span className="ml-1 text-sm font-medium text-ferry-orange-deep">{arrival.dayMarker}</span>
                ) : null}
                {journey ? (
                  <span className="ml-2 hidden text-sm font-normal text-gray-500 sm:inline">· {journey}</span>
                ) : null}
              </span>
            ) : null}
          </span>
          {note ? <span className="text-xs text-gray-600 dark:text-night-text/70">{note}</span> : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {minutes != null && !cancelled ? <CountdownChip minutes={minutes} /> : null}
        {delay ? (
          <span className="text-xs font-medium text-cancel-text dark:text-ferry-sunset">{delay}</span>
        ) : null}
      </span>
    </>
  )
  const surface = cx(
    'w-full rounded-card px-4 py-3.5 text-left transition',
    highlighted
      ? 'bg-hot border-2 border-ferry-orange shadow-hot'
      : 'bg-white/90 shadow-card border-2 border-transparent hover:border-ferry-orange/40 dark:bg-night-card',
    cancelled && 'opacity-85',
  )
  return (
    <article
      className={surface}
      data-highlighted={highlighted || undefined}
      data-cancelled={cancelled || undefined}
    >
      {href ? (
        <LinkAs
          {...(LinkAs === 'a' ? { href } : { to: href })}
          aria-label={label}
          className="flex min-h-[4.25rem] w-full cursor-pointer items-center justify-between gap-2.5 text-left text-inherit no-underline"
        >
          {body}
        </LinkAs>
      ) : onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-label={label}
          className="flex min-h-[4.25rem] w-full cursor-pointer items-center justify-between gap-2.5 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-[4.25rem] items-center justify-between gap-2.5">{body}</div>
      )}
      {below ? <div className="mt-2">{below}</div> : null}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export function PrimaryButton({ className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'min-h-12 rounded-button bg-ferry-orange-aa px-5 text-base font-bold text-white shadow-md transition hover:bg-ferry-orange-deep active:scale-95 disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  )
}

export function SecondaryButton({ className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'min-h-12 rounded-button border-2 border-ferry-orange bg-white px-5 text-base font-semibold text-ferry-orange-deep transition hover:bg-ferry-orange-light active:scale-95 disabled:opacity-60 dark:bg-night-card dark:text-ferry-sunset',
        className,
      )}
      {...rest}
    />
  )
}

export function MoreButton({ className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'bg-more min-h-12 w-full rounded-button border-2 border-ferry-orange/30 text-[15px] font-bold text-ferry-orange-deep transition hover:border-ferry-orange dark:text-ferry-sunset',
        className,
      )}
      {...rest}
    />
  )
}
