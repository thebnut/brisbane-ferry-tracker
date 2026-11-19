/**
 * The board header's trip parts (with @bft/ui/board-header), off every other page's first load:
 *  - TripPlaces: a board with a destination set (a ferry's `?to=`) names the trip, "YOUR TRIP" with From over To and a
 *    swap button, so the countdowns read as when the ferry leaves, not the trip time.
 *  - DestinationField: a board without one asks "Where are you going from here?", with "Not at <place>? Plan a trip
 *    there ›" for someone who opened the board of where they are going.
 */
import type { ReactNode } from 'react'
import { Icon } from './icons.tsx'

/**
 * A trip board's places, as the board header's name: From over To with a line between their dots, To's words a
 * button that changes the destination, and a swap button beside them.
 */
export function TripPlaces({
  from,
  to,
  as: Tag = 'h2',
  onTo,
  onSwap,
}: {
  from: string
  to: string
  /** The trip's heading level, read by screen readers ("From Bulimba to Riverside"). */
  as?: 'h1' | 'h2'
  /** Opens the destination sheet. */
  onTo: () => void
  onSwap: () => void
}) {
  const label =
    'block text-xs font-semibold tracking-[0.06em] text-sched-text uppercase dark:text-night-text/70'
  return (
    <div className="flex items-center gap-2 text-base font-normal">
      <Tag className="sr-only">
        From {from} to {to}
      </Tag>
      <span aria-hidden="true" className="flex shrink-0 flex-col items-center self-stretch py-2">
        <span className="size-3 rounded-full border-[3px] border-aqua-text dark:border-ferry-aqua-light" />
        <span className="w-0.5 flex-1 bg-aqua-text/40 dark:bg-ferry-aqua-light/40" />
        <span className="size-3 rounded-full bg-ferry-orange" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span data-trip-place="from" aria-hidden="true">
          <span className={label}>From</span>
          <span className="block text-xl leading-tight font-extrabold [overflow-wrap:anywhere]">{from}</span>
        </span>
        <span data-trip-place="to">
          <span aria-hidden="true" className={label}>
            To
          </span>
          <button
            type="button"
            onClick={onTo}
            aria-haspopup="dialog"
            aria-label={`To ${to}. Change destination`}
            className="flex min-h-11 items-center gap-1 text-left text-xl leading-tight font-extrabold [overflow-wrap:anywhere] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text"
          >
            {to}
            <Icon
              name="chevronDown"
              size={18}
              className="shrink-0 text-ferry-orange-deep dark:text-ferry-sunset"
            />
          </button>
        </span>
      </span>
      <button
        type="button"
        onClick={onSwap}
        aria-label="Swap direction"
        data-chip=""
        className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ferry-orange/30 bg-white text-ferry-orange-deep focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:bg-night-card dark:text-ferry-sunset"
      >
        <Icon name="swap" size={18} className="rotate-90" />
      </button>
    </div>
  )
}

/**
 * "Where are you going from here?": a full-width field that opens the board's destination sheet, and under it, for
 * someone who opened the wrong board, "Not at <place>? Plan a trip there ›" (`plan`, the planner with To set).
 */
export function DestinationField({
  label = 'Where are you going from here?',
  onClick,
  plan,
}: {
  label?: string
  onClick: () => void
  plan?: {
    place: string
    href: string
    renderLink?: (p: { href: string; className: string; children: ReactNode }) => ReactNode
  }
}) {
  const linkClass = 'font-bold text-aqua-text no-underline hover:underline dark:text-ferry-aqua-light'
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        data-destination-field=""
        className="flex min-h-12 w-full items-center gap-3 rounded-card border-2 border-ferry-orange bg-white px-3.5 text-left text-base font-bold text-ferry-orange-deep focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:bg-night-2 dark:text-ferry-sunset"
      >
        <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-ferry-orange" />
        <span className="min-w-0 flex-1">{label}</span>
        <Icon name="chevronDown" size={18} className="shrink-0" />
      </button>
      {plan ? (
        <p data-plan-there="" className="text-sm text-sched-text dark:text-night-text/80">
          Not at {plan.place}?{' '}
          {plan.renderLink ? (
            plan.renderLink({ href: plan.href, className: linkClass, children: 'Plan a trip there ›' })
          ) : (
            <a href={plan.href} className={linkClass}>
              Plan a trip there ›
            </a>
          )}
        </p>
      ) : null}
    </div>
  )
}
