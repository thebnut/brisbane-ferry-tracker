/**
 * The journey planner card at the top of the ferry and train homes ("Where are you going?"): From first, the start of
 * your journey (the nearest place once location has been allowed, otherwise "Choose start"), then To, with a swap
 * button between them, Popular destinations as chips that fill To, and the answer under them (the app's: a link to
 * the from-to board, or where to change). Server-rendered, so the page doesn't move when it hydrates; the pickers are
 * the app's sheets (@bft/ui/planner-sheets), loaded when first opened. Never asks for location by itself.
 */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

export interface PlannerPlace {
  name: string
  /** Under the name: "Nearest terminal", "for Eat Street", a closure note. */
  hint?: string | null
}

const ROW =
  'flex min-h-14 w-full items-center gap-3 rounded-card border-2 bg-white px-3.5 py-2 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:bg-night-2'

function PlaceRow({
  label,
  place,
  empty,
  next,
  swap,
  onClick,
}: {
  label: 'From' | 'To'
  place: PlannerPlace | null
  empty: string
  /** The step to take now: the orange outline. */
  next: boolean
  /** The swap button sits over the rows' right side: keep the words clear of it. */
  swap: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      data-planner-place={label.toLowerCase()}
      className={cx(
        ROW,
        next
          ? 'border-ferry-orange'
          : 'border-ferry-orange/15 hover:border-ferry-orange/50 dark:border-night-card',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-3 shrink-0 rounded-full border-[3px]',
          label === 'To'
            ? 'border-ferry-orange bg-ferry-orange'
            : 'border-aqua-text dark:border-ferry-aqua-light',
        )}
      />
      <span className="w-11 shrink-0 text-xs font-bold tracking-[0.08em] text-sched-text uppercase dark:text-night-text/70">
        {label}
      </span>
      <span className={cx('flex min-w-0 flex-1 flex-col', swap && 'mr-10')}>
        <span
          className={cx(
            'text-[17px] leading-snug font-bold [overflow-wrap:anywhere]',
            place ? 'text-charcoal dark:text-night-text' : 'text-ferry-orange-deep dark:text-ferry-sunset',
          )}
        >
          {place?.name ?? empty}
        </span>
        {place?.hint ? (
          <span className="text-[13px] text-sched-text dark:text-night-text/70">{place.hint}</span>
        ) : null}
      </span>
      <Icon name="chevronDown" size={18} className="shrink-0 text-ferry-orange-deep dark:text-ferry-sunset" />
    </button>
  )
}

export interface PlannerCardProps {
  from: PlannerPlace | null
  to: PlannerPlace | null
  /** "Choose start". */
  fromEmpty: string
  /** "Pick a terminal". */
  toEmpty: string
  onFrom: () => void
  onTo: () => void
  /** Offered once both are set. */
  onSwap?: () => void
  /** Popular destinations: chips that fill To. */
  popular?: ReadonlyArray<{ id: string; name: string }>
  onPopular?: (id: string) => void
  /** The answer under the places: the board link, or where to change. */
  children?: ReactNode
}

export function PlannerCard({
  from,
  to,
  fromEmpty,
  toEmpty,
  onFrom,
  onTo,
  onSwap,
  popular = [],
  onPopular,
  children,
}: PlannerCardProps) {
  return (
    <section
      aria-labelledby="planner"
      data-planner=""
      className="flex flex-col gap-3 rounded-card border border-ferry-orange/15 bg-white/70 px-3.5 pt-3.5 pb-4 shadow-card dark:bg-night-card"
    >
      <h2
        id="planner"
        className="text-[13px] font-bold tracking-[0.08em] text-ferry-orange-deep uppercase dark:text-ferry-sunset"
      >
        Where are you going?
      </h2>
      <div className="relative flex flex-col gap-2">
        <PlaceRow
          label="From"
          place={from}
          empty={fromEmpty}
          next={!from && !!to}
          swap={!!onSwap}
          onClick={onFrom}
        />
        <PlaceRow label="To" place={to} empty={toEmpty} next={!to} swap={!!onSwap} onClick={onTo} />
        {onSwap ? (
          <button
            type="button"
            onClick={onSwap}
            aria-label="Swap From and To"
            data-planner-swap=""
            className="absolute top-1/2 right-11 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border-2 border-ferry-orange/30 bg-white text-ferry-orange-deep shadow-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:bg-night-card dark:text-ferry-sunset"
          >
            <Icon name="swap" size={18} className="rotate-90" />
          </button>
        ) : null}
      </div>
      {children}
      {popular.length && onPopular ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-night-text/80">Popular</h3>
          <ul className="flex flex-wrap gap-2" aria-label="Popular destinations">
            {popular.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPopular(p.id)}
                  className="flex min-h-11 items-center rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-sm font-semibold text-aqua-text hover:border-ferry-orange/50 hover:text-ferry-orange-deep focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text dark:bg-night-2 dark:text-ferry-aqua-light"
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/** The planner's answer for a direct trip: one big link to the from-to board. A plain link, so it works before hydration. */
export function PlanLink({
  href,
  children,
  renderLink,
}: {
  href: string
  children: ReactNode
  renderLink?: (p: { href: string; className: string; children: ReactNode }) => ReactNode
}) {
  const className =
    'flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-ferry-orange-aa px-4 text-base font-bold text-white no-underline shadow-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-aqua-text'
  const body = (
    <>
      {children}
      <Icon name="chevronRight" size={18} />
    </>
  )
  return (
    <div data-plan-link="">
      {renderLink ? (
        renderLink({ href, className, children: body })
      ) : (
        <a href={href} className={className}>
          {body}
        </a>
      )}
    </div>
  )
}
