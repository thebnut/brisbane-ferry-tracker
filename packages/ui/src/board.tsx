/**
 * Departure board building blocks: countdown chip, status badges and buttons (the row: row.tsx; the board header and
 * filter row: board-header.tsx).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
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
      data-live-claim={kind === 'live' || kind === 'gps' ? '' : undefined}
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
