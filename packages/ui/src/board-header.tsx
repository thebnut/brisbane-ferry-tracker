/**
 * The board header and its filter row (THE-118 PR 5), the same on every mode's board: the mode kicker ("FERRY
 * TERMINAL"), the place's name, one sub-line of facts (platforms or stop number, routes or lines, the alert count) and
 * the labelled star, then one row of 44 px chips that scrolls sideways on phones. The status line follows the header.
 */
import { type ReactNode, useMemo } from 'react'
import { cx } from './cx.ts'
import { Icon, type IconName } from './icons.tsx'
import { generateTimeSlots } from './time-slots.ts'

export { generateTimeSlots, type Slot } from './time-slots.ts'

export interface BoardHeaderProps {
  /** "TRAIN STATION", "BUS STOP", "FERRY TERMINAL". */
  kicker: string
  name: ReactNode
  /** The name's heading level: h1 unless the page has its own (the SEO section's "Next ferry from …"). */
  as?: 'h1' | 'h2'
  /** The sub-line, joined with " · "; empty entries are left out. */
  facts?: ReactNode[]
  /** The labelled star (StarButton), top right. */
  star?: ReactNode
  /** The filter row. */
  children?: ReactNode
}

export function BoardHeader({ kicker, name, as: Tag = 'h1', facts = [], star, children }: BoardHeaderProps) {
  const shown = facts.filter((f) => f != null && f !== false && f !== '')
  return (
    <div
      data-board-header=""
      className="bg-board-header flex flex-col gap-1.5 rounded-card border border-ferry-orange/10 px-3.5 pt-3 pb-1.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <p
            data-kicker=""
            className="text-[11px] font-bold tracking-[0.12em] text-ferry-orange-deep uppercase dark:text-ferry-sunset"
          >
            {kicker}
          </p>
          <Tag className="text-2xl leading-tight font-extrabold text-charcoal [overflow-wrap:anywhere] dark:text-night-text">
            {name}
          </Tag>
          {shown.length ? (
            // The " · " between facts is the stylesheet's (theme.css), so a fact that renders nothing (the standalone
            // apps' empty alert slot) leaves no stray separator.
            <div
              data-board-facts=""
              className="flex min-h-6 flex-wrap items-center gap-x-1.5 text-sm text-sched-text dark:text-night-text/80"
            >
              {shown.map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of facts, in order.
                <span key={i} data-fact="" className="inline-flex items-center">
                  {f}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {star}
      </div>
      {children}
    </div>
  )
}

/** The chip look, for a chip that is a link (the train board's Map). */
export const chipClass = (on = false, iconOnly = false) =>
  cx(
    iconOnly ? 'w-11' : 'px-4',
    'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm whitespace-nowrap no-underline transition active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
    on
      ? 'bg-ferry-orange-aa font-bold text-white'
      : 'border border-ferry-orange/30 bg-white font-semibold text-ferry-orange-deep hover:border-ferry-orange dark:bg-night-card dark:text-ferry-sunset',
  )

/** One row of chips: scrolls sideways on phones (room for the focus ring above and below), wraps on wider screens. */
export function FilterRow({ label = 'Filters', children }: { label?: string; children: ReactNode }) {
  return (
    // min-w-0: a fieldset is as wide as its content otherwise, and would never scroll.
    <fieldset
      data-filter-row=""
      className="-mx-3.5 flex min-w-0 gap-2 overflow-x-auto px-3.5 py-1.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  )
}

export interface ChipProps {
  children?: ReactNode
  onClick: () => void
  /** A toggle or one of a set (All / Express / a route): `aria-pressed`. Undefined: a plain button. */
  pressed?: boolean
  /** Shown on: a set destination, an open map. Defaults to `pressed`. */
  on?: boolean
  icon?: IconName
  /** A "▾" chip that opens a sheet. */
  opens?: boolean
  /** The accessible name when the chip has no words (⇄). */
  label?: string
}

export function Chip({ children, onClick, pressed, on = pressed, icon, opens, label }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-haspopup={opens ? 'dialog' : undefined}
      aria-label={label}
      data-chip=""
      className={chipClass(on, !children)}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {opens ? <Icon name="chevronDown" size={16} className="-mr-1" /> : null}
    </button>
  )
}

/**
 * "Now ▾": the "Depart from" time, rarely used, so disclosed as a chip. A native select laid over the chip's words,
 * so it is the platform's own picker and works before hydration; `value` null is now.
 */
export function NowChip({
  value,
  onChange,
  nowMs,
}: {
  value: number | null
  onChange: (at: number | null) => void
  /** The board's clock; the slots move on once an hour. */
  nowMs: number
}) {
  const hour = Math.floor(nowMs / 3_600_000)
  const slots = useMemo(() => generateTimeSlots(hour * 3_600_000), [hour])
  const picked = value == null ? null : slots.find((s) => s.type === 'slot' && s.at === value)
  const words =
    value == null
      ? 'Now'
      : picked?.type === 'slot'
        ? `From ${picked.label}${picked.today ? '' : ' tomorrow'}`
        : 'Later'
  return (
    // The select is invisible, so the chip shows its focus ring.
    <label
      data-chip="now"
      className={cx(
        chipClass(value != null),
        'relative has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-aqua-text has-[:focus-visible]:outline-solid',
      )}
    >
      <span aria-hidden="true">{words}</span>
      <Icon name="chevronDown" size={16} className="-mr-1" />
      <select
        aria-label="Depart from"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Now</option>
        {slots.map((s) =>
          s.type === 'separator' ? (
            <option key="sep" disabled value="sep">
              {s.label}
            </option>
          ) : (
            <option key={s.at} value={s.at}>
              {s.label}
            </option>
          ),
        )}
        {/* A time from before the slots moved on (a saved session value) stays selectable. */}
        {value != null && !picked ? <option value={value}>Later</option> : null}
      </select>
    </label>
  )
}
