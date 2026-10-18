/**
 * Multimodal pieces for BrisbaneTransit (X-* boards): modes are told apart by pictogram + label + pin shape (ferry
 * circle, train square, bus diamond) in the teal/orange family, never by a new brand colour (ferry-look-spec.md).
 */
import type { ReactNode } from 'react'
import { CountdownChip } from './board.tsx'
import { cx } from './cx.ts'
import { Icon } from './icons.tsx'

export type TransitMode = 'ferry' | 'train' | 'bus'

const MODE_LABEL: Record<TransitMode, string> = { ferry: 'Ferry', train: 'Train', bus: 'Bus' }

/** Tile and text tints per mode (spec "Colour": ferry light aqua, train deep teal, bus orange). */
const MODE_TILE: Record<TransitMode, string> = {
  ferry: 'bg-[#E0F6FB] text-aqua-text dark:bg-night-2 dark:text-ferry-aqua-light',
  train: 'bg-[#DDEFEF] text-teal-text dark:bg-night-2 dark:text-ferry-aqua-light',
  bus: 'bg-ferry-orange-light text-ferry-orange-deep dark:bg-night-2 dark:text-ferry-sunset',
}
export const MODE_TEXT: Record<TransitMode, string> = {
  ferry: 'text-aqua-text dark:text-ferry-aqua-light',
  train: 'text-teal-text dark:text-ferry-aqua-light',
  bus: 'text-ferry-orange-deep dark:text-ferry-sunset',
}

/** Map/list pin in the mode's shape: ferry circle, train square, bus diamond. */
export function ModePin({ mode, className }: { mode: TransitMode; className?: string }) {
  return (
    <span
      data-pin={mode}
      aria-hidden="true"
      className={cx(
        'inline-block shrink-0',
        mode === 'ferry' && 'size-3.5 rounded-full bg-ferry-aqua ring-2 ring-aqua-text',
        mode === 'train' && 'size-3.5 rounded-[3px] bg-teal-text',
        mode === 'bus' && 'mx-0.5 size-[11px] rotate-45 bg-ferry-orange-dark',
        className,
      )}
    />
  )
}

/** Rounded tile with the mode pictogram (Saved cards, alert cards). */
export function ModeTile({ mode, size = 'md' }: { mode: TransitMode; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center',
        size === 'md' ? 'size-9.5 rounded-[10px]' : 'size-8 rounded-lg',
        MODE_TILE[mode],
      )}
    >
      <Icon name={mode} size={20} title={MODE_LABEL[mode]} />
    </span>
  )
}

/** Route/line short name in a mode-tinted tile (bus: the solid teal "blind" tile). */
export function ModeRouteTile({ mode, route }: { mode: TransitMode; route: string }) {
  return (
    <span
      className={cx(
        'flex h-8 min-w-10 shrink-0 items-center justify-center rounded-button px-1.5 text-sm font-extrabold tabular',
        mode === 'bus' ? 'bg-teal-text text-white' : MODE_TILE[mode],
      )}
    >
      {route}
    </span>
  )
}

export type CueTone = 'late' | 'hurry' | 'good'
const CUE: Record<CueTone, string> = {
  late: 'text-cancel-text dark:text-red-300',
  hurry: 'text-ferry-orange-deep dark:text-ferry-sunset',
  good: 'text-chip-later-text dark:text-green-300',
}

export interface NearbyDepartureRowProps {
  mode: TransitMode
  route: string
  /** Headsign. */
  to: string
  /** Stop name (omitted when the row sits under its stop's heading). */
  stop?: string | null
  /** "3 min walk". */
  walk?: string | null
  minutes: number
  /** "Too late", "Hurry", "On your way", "Plenty of time". */
  cue?: { text: string; tone: CueTone } | null
  cancelled?: boolean
  href?: string
  renderLink?: (props: { href: string; className: string; children: ReactNode }) => ReactNode
}

/** One "leaving soon near you" row (X-Map sheet): pin, route tile, destination, stop · walk, countdown + cue. */
export function NearbyDepartureRow({
  mode,
  route,
  to,
  stop,
  walk,
  minutes,
  cue,
  cancelled = false,
  href,
  renderLink,
}: NearbyDepartureRowProps) {
  const className = cx(
    'flex min-h-14 items-center gap-2.5 rounded-card bg-white/90 px-3 py-2 text-inherit no-underline shadow-card dark:bg-night-card',
    cancelled && 'opacity-80',
  )
  const body = (
    <>
      <ModePin mode={mode} />
      <ModeRouteTile mode={mode} route={route} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx('truncate text-[15px] font-bold', cancelled && 'line-through')}>{to}</span>
        <span className="truncate text-xs text-sched-text dark:text-night-text/70">
          {[stop, walk].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {cancelled ? (
          <span className="rounded-full bg-cancel-bg px-2.5 py-1 text-xs font-extrabold text-cancel-text">
            CANCELLED
          </span>
        ) : (
          <CountdownChip minutes={minutes} className="px-2.5 py-1 text-[15px]" />
        )}
        {cue && !cancelled ? (
          <span className={cx('text-[11px] font-bold', CUE[cue.tone])}>{cue.text}</span>
        ) : null}
      </span>
    </>
  )
  if (href)
    return renderLink ? (
      renderLink({ href, className, children: body })
    ) : (
      <a href={href} className={className}>
        {body}
      </a>
    )
  return <div className={className}>{body}</div>
}

export interface SavedTripCardProps {
  mode: TransitMode
  /** e.g. "BUS · CULTURAL CENTRE, PLATFORM 1" (upper-cased by the card). */
  label: string
  /** e.g. "66 to UQ Lakes" or "Bulimba → Riverside". */
  title: string
  live?: boolean
  /** "7:46 pm → 7:58 pm". */
  time?: string | null
  detail?: string | null
  minutes?: number | null
  /** The departures after the next, shown as "Then 8:01 F1   8:16 F11". */
  later?: string | null
  highlighted?: boolean
  /** Shown instead of the time row (no departures, loading, offline without a copy). */
  empty?: ReactNode
  /** `empty` is a loading state (marked data-loading), not a final one. */
  loading?: boolean
  href: string
  /** The link's name is its content (mode, place, times), so screen readers hear the departures too. */
  renderLink?: (props: { href: string; className: string; children: ReactNode }) => ReactNode
}

/** A saved stop or trip from any mode (X-Home): mode tile + label, LIVE, next time and countdown, "Then". */
export function SavedTripCard({
  mode,
  label,
  title,
  live = false,
  time,
  detail,
  minutes,
  later,
  highlighted = false,
  empty,
  loading = false,
  href,
  renderLink,
}: SavedTripCardProps) {
  const className = cx(
    'flex flex-col gap-2.5 rounded-card px-4 py-3.5 text-inherit no-underline',
    highlighted
      ? 'bg-hot border-2 border-ferry-orange shadow-hot'
      : 'bg-white/90 shadow-card dark:bg-night-card',
  )
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
              {label}
            </span>
            <span className="truncate text-[15px] font-bold">{title}</span>
          </span>
        </span>
        {live ? (
          <span
            data-live-claim=""
            className="shrink-0 rounded-full bg-ferry-orange-aa px-2.5 py-0.5 text-[11px] font-bold text-white"
          >
            LIVE
          </span>
        ) : null}
      </span>
      {empty ? (
        <span data-loading={loading ? '' : undefined} className="text-sm text-sched-text dark:text-night-text/70">
          {empty}
        </span>
      ) : (
        <>
          <span className="flex items-center justify-between gap-2.5">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span data-saved-time="" className="text-[21px] font-extrabold tabular">
                {time}
              </span>
              {detail ? (
                <span className="truncate text-[13px] text-gray-600 dark:text-night-text/70">{detail}</span>
              ) : null}
            </span>
            {minutes != null ? <CountdownChip minutes={minutes} className="text-[17px]" /> : null}
          </span>
          {later ? (
            <span className="flex gap-2 border-t border-dashed border-ferry-orange/25 pt-2 text-[13px] tabular text-gray-700 dark:text-night-text/80">
              <span className="font-semibold">Then</span>
              <span>{later}</span>
            </span>
          ) : null}
        </>
      )}
    </>
  )
  return renderLink ? (
    renderLink({ href, className, children: body })
  ) : (
    <a href={href} className={className}>
      {body}
    </a>
  )
}

export type AlertSeverityKind = 'detour' | 'platform' | 'changed' | 'cancelled' | 'planned' | 'info'
const SEVERITY: Record<AlertSeverityKind, { label: string; className: string }> = {
  detour: { label: 'DETOUR', className: 'bg-amber-100 text-amber-800' },
  platform: { label: 'PLATFORM CHANGE', className: 'bg-ferry-orange-light text-ferry-orange-deep' },
  changed: { label: 'CHANGED', className: 'bg-ferry-orange-light text-ferry-orange-deep' },
  cancelled: { label: 'CANCELLED', className: 'bg-cancel-bg text-cancel-text' },
  planned: { label: 'PLANNED', className: 'bg-sched-bg text-gray-700' },
  info: { label: 'NOTICE', className: 'bg-ferry-light-blue text-aqua-text' },
}

export interface ModeAlertCardProps {
  /** null: a network-wide notice (no mode). */
  mode: TransitMode | null
  /** "BUS · ROUTE 66". */
  scope: string
  severity: AlertSeverityKind
  title: string
  body?: string | null
  /** "Your saved stop · about +3 min": highlighted card. */
  impact?: string | null
}

/** One alert in the merged list (X-Alerts): mode tile + scope, severity chip, title, body, impact on your trips. */
export function ModeAlertCard({ mode, scope, severity, title, body, impact }: ModeAlertCardProps) {
  const s = SEVERITY[severity]
  return (
    <article
      data-mode={mode ?? 'all'}
      className={cx(
        'flex flex-col gap-1.5 rounded-card px-3.5 py-3',
        impact
          ? 'bg-hot border-2 border-ferry-orange shadow-hot'
          : 'bg-white/90 shadow-card dark:bg-night-card',
      )}
    >
      <div className="flex items-center gap-2">
        {mode ? (
          <ModeTile mode={mode} size="sm" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ferry-light-blue text-aqua-text dark:bg-night-2">
            <Icon name="info" size={18} />
          </span>
        )}
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-[11px] font-extrabold tracking-[0.06em]',
            mode ? MODE_TEXT[mode] : 'text-aqua-text dark:text-ferry-aqua-light',
          )}
        >
          {scope}
        </span>
        <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold', s.className)}>
          {s.label}
        </span>
      </div>
      <h2 className="text-[15px] font-bold">{title}</h2>
      {body ? <p className="text-[13px] text-gray-700 dark:text-night-text/80">{body}</p> : null}
      {impact ? (
        <span className="text-xs font-bold text-ferry-orange-deep dark:text-ferry-sunset">{impact}</span>
      ) : null}
    </article>
  )
}

export interface ChipOption<T extends string> {
  value: T
  label: string
  count?: number
}

/** Horizontally scrolling filter chips (X-Alerts mode chips, X-Map mode filter). */
export function ChipFilter<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<T>[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <fieldset className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap',
              on
                ? 'bg-ferry-orange-aa font-bold text-white'
                : 'border border-ferry-orange/30 bg-white font-semibold text-gray-700 dark:bg-night-card dark:text-night-text',
            )}
          >
            {o.value === 'ferry' || o.value === 'train' || o.value === 'bus' ? (
              <ModePin mode={o.value as TransitMode} className={on ? 'ring-white' : undefined} />
            ) : null}
            {o.label}
            {o.count != null ? <span className="tabular">{o.count}</span> : null}
          </button>
        )
      })}
    </fieldset>
  )
}

export interface SectionLink {
  key: string
  label: string
  href: string
}

/**
 * A mode's own sections (e.g. Bus: My stops, Nearby, Map, Alerts) as a compact pill row. Inside BrisbaneTransit it
 * sits just above the Mode Tabs, so the standalone app's sections stay one tap away without a second bottom bar.
 */
export function SectionTabs({
  items,
  active,
  label,
  renderLink,
  className,
}: {
  items: SectionLink[]
  active: string
  label: string
  renderLink?: (item: SectionLink, className: string, current: boolean) => ReactNode
  className?: string
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="mx-auto flex max-w-xl gap-1.5 overflow-x-auto px-3 py-1.5">
        {items.map((i) => {
          const on = i.key === active
          const cls = cx(
            'flex h-8 shrink-0 items-center rounded-full px-3 text-xs whitespace-nowrap no-underline',
            on
              ? 'bg-ferry-orange-aa font-bold text-white'
              : 'border border-ferry-orange/20 bg-white font-semibold text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light',
          )
          return (
            <li key={i.key}>
              {renderLink ? (
                renderLink(i, cls, on)
              ) : (
                <a href={i.href} className={cls} aria-current={on ? 'page' : undefined}>
                  {i.label}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
