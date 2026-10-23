/**
 * Train elements (only the train pages and ferry trip details load them, THE-118 PR 4): the row's platform tile on the
 * line colour, the old platform tile, the stopping-pattern strip, line chips and the service timeline. Out of the
 * shared @bft/ui chunk, so the ferry and bus first loads don't carry them.
 */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'

const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two hex colours (no #). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Text on a line colour (hex, no #): charcoal on light lines (Gold Coast, Redcliffe), else white. A cheap brightness
 * rule; the tests hold every line colour to 4.5:1 with contrastRatio (only the tests use it).
 */
export const textOn = (bg: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(bg.slice(i, i + 2), 16)) as [number, number, number]
  return r * 299 + g * 587 + b * 114 > 150_000 ? '2D3436' : 'FFFFFF'
}

export interface PlatformLineTileProps {
  platform: string | null
  /** Line colour, hex without #. */
  color: string
  /** A live platform change: the timetabled platform. The tile gets an orange ring. */
  changedFrom?: string | null
}

/** Train: the platform number on the line colour, labelled PLAT; an orange ring when the platform changed. */
export function PlatformLineTile({ platform, color, changedFrom }: PlatformLineTileProps) {
  return (
    <span
      role="img"
      data-platform-change={changedFrom ? 'true' : undefined}
      aria-label={
        platform
          ? `Platform ${platform}${changedFrom ? `, changed from ${changedFrom}` : ''}`
          : 'Platform not known'
      }
      className={cx(
        'flex size-13 shrink-0 flex-col items-center justify-center rounded-card leading-none max-[420px]:size-12',
        changedFrom &&
          'ring-[3px] ring-ferry-orange-aa ring-offset-2 ring-offset-white dark:ring-ferry-sunset dark:ring-offset-night-card',
      )}
      style={{ background: `#${color}`, color: `#${textOn(color)}` }}
    >
      <span className="text-[9px] font-bold tracking-wide">PLAT</span>
      <span className="text-2xl font-extrabold tabular">{platform ?? '–'}</span>
    </span>
  )
}

export interface PatternStop {
  id: string
  name: string
  /** false = the service runs through without stopping (hollow dot). */
  stops: boolean
  /** Stations were left out before this one (long runs are shortened); drawn as a dashed gap. */
  gapBefore?: boolean
}

export interface StoppingPatternProps {
  stops: PatternStop[]
  /** Line colour (hex without #) from route data; defaults to aqua. */
  color?: string
  label?: string
  /**
   * Dots only (the departure-card strip in T-Departures): names go to screen readers and tooltips, so a 14-station
   * run fits a phone row. Without it every dot is labelled (detail views).
   */
  compact?: boolean
}

const lineColourOf = (color?: string) => (color ? `#${color}` : 'var(--color-ferry-aqua)')

/** Dots on a line in the line's colour; hollow dots for stations an express runs through. */
export function StoppingPattern({
  stops,
  color,
  label = 'Stopping pattern',
  compact = false,
}: StoppingPatternProps) {
  if (stops.length === 0) return null
  const lineColour = lineColourOf(color)
  const skipped = stops.filter((s) => !s.stops).length
  return (
    <ol
      aria-label={skipped ? `${label}, runs through ${skipped} station${skipped === 1 ? '' : 's'}` : label}
      data-compact={compact || undefined}
      className={cx(
        'relative flex justify-between',
        compact ? 'h-3.5 items-center gap-0.5' : 'items-start gap-1 overflow-x-auto pt-1 pb-0.5',
      )}
    >
      <span
        aria-hidden="true"
        className={cx('absolute right-1.5 left-1.5 h-1 rounded-full', compact ? 'top-[5px]' : 'top-[11px]')}
        style={{ background: lineColour }}
      />
      {stops.map((s) => (
        <li
          key={s.id}
          data-stops={s.stops}
          title={compact ? s.name : undefined}
          className={cx(
            'relative z-10 flex flex-col items-center gap-1',
            compact ? 'shrink-0' : 'min-w-0 flex-1',
          )}
        >
          {s.gapBefore ? (
            <span aria-hidden="true" className="absolute top-[5px] right-full mr-0.5 h-1 w-2 bg-white/90" />
          ) : null}
          <span
            aria-hidden="true"
            className={cx(
              'box-border rounded-full',
              s.stops ? 'size-3.5 border-[3px] border-white' : 'size-2.5 border-2 bg-white',
            )}
            style={
              s.stops
                ? { background: lineColour, boxShadow: `0 0 0 1px ${lineColour}` }
                : { borderColor: lineColour }
            }
          />
          <span
            className={cx(
              compact ? 'sr-only' : 'max-w-full truncate text-center text-[10px] leading-tight',
              !compact && (s.stops ? 'font-semibold text-charcoal dark:text-night-text' : 'text-sched-text'),
            )}
          >
            {s.gapBefore ? <span className="sr-only">… then </span> : null}
            {s.name}
            {s.stops ? null : <span className="sr-only"> (runs through)</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

export interface LineChipProps {
  name: string
  /** Line colour, hex without #. */
  color?: string
  /** Filled pill (white text on the line colour) for headings; otherwise a dot + name. */
  solid?: boolean
  children?: ReactNode
}

/** Train line label: coloured dot + name (chips), or a solid pill in the line colour (picker headings). */
export function LineChip({ name, color, solid = false, children }: LineChipProps) {
  const c = lineColourOf(color)
  if (solid) {
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold text-white"
        style={{ background: c, textShadow: '0 0 2px rgb(0 0 0 / 0.55)' }}
      >
        {name}
        {children}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sched-bg px-2.5 py-1 text-xs font-semibold text-charcoal dark:bg-night-2 dark:text-night-text">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: c }} />
      {name}
      {children}
    </span>
  )
}
