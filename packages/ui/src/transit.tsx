/** Train and bus elements restyled in the ferry look: platform tile, route tile, stopping-pattern strip. */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export interface PlatformTileProps {
  platform: string | null
  /** Platform it was scheduled from; when different, shows the orange "NOW n" change tile. */
  scheduledPlatform?: string | null
}

/** Is this a platform change? Both known and different (case/whitespace-insensitive). */
export function isPlatformChange(
  platform: string | null | undefined,
  scheduled: string | null | undefined,
): boolean {
  if (!platform || !scheduled) return false
  return platform.trim().toUpperCase() !== scheduled.trim().toUpperCase()
}

export function PlatformTile({ platform, scheduledPlatform }: PlatformTileProps) {
  const changed = isPlatformChange(platform, scheduledPlatform)
  if (changed) {
    return (
      <span
        role="img"
        data-platform-change="true"
        className="flex size-14 shrink-0 flex-col items-center justify-center rounded-card bg-ferry-orange-aa text-white shadow-card"
        aria-label={`Platform changed to ${platform}, was ${scheduledPlatform}`}
      >
        <span className="text-[10px] leading-none font-extrabold tracking-wide">NOW</span>
        <span className="text-2xl leading-none font-extrabold tabular">{platform}</span>
        <span className="text-[10px] leading-none line-through opacity-90">{scheduledPlatform}</span>
      </span>
    )
  }
  return (
    <span
      role="img"
      className="flex size-14 shrink-0 flex-col items-center justify-center rounded-card border border-ferry-orange/15 bg-white shadow-card dark:bg-night-2"
      aria-label={platform ? `Platform ${platform}` : 'Platform not known'}
    >
      <span className="text-[9px] leading-none font-bold tracking-wide text-sched-text">PLAT</span>
      <span className="text-2xl leading-tight font-extrabold text-teal-text tabular dark:text-ferry-aqua-light">
        {platform ?? '–'}
      </span>
    </span>
  )
}

export type RouteTileSize = 'sm' | 'md' | 'lg' | 'xl'

export interface RouteTileProps {
  route: string
  /** Metro, CityGlider and BUZ routes use the orange tile. */
  variant?: 'standard' | 'premium'
  /** sm: chips in lists; md: My stops rows; lg: departure rows (default); xl: trip detail hero. */
  size?: RouteTileSize
  className?: string
}

const PREMIUM = /^(M\d+|GLIDER|G\d+|BUZ)$/i
/** CityGlider routes (route_long_name doesn't say so in the SEQ feed). */
export const CITYGLIDER_ROUTES: ReadonlySet<string> = new Set(['60', '61'])
/** BUZ (high-frequency) routes, translink.com.au/travel-with-us/buses/buz, October 2026. */
export const BUZ_ROUTES: ReadonlySet<string> = new Set([
  '100',
  '111',
  '120',
  '130',
  '140',
  '150',
  '180',
  '196',
  '199',
  '200',
  '222',
  '330',
  '333',
  '340',
  '345',
  '385',
  '412',
  '444',
  '555',
])

/** Bus routes that get the orange tile: Brisbane Metro (M1, M2), CityGlider and BUZ routes. */
export function routeTileVariant(route: string, routeLong?: string): 'standard' | 'premium' {
  if (PREMIUM.test(route) || CITYGLIDER_ROUTES.has(route) || BUZ_ROUTES.has(route)) return 'premium'
  if (routeLong && /cityglider|metro/i.test(routeLong)) return 'premium'
  return 'standard'
}

const TILE_SIZE: Record<RouteTileSize, string> = {
  sm: 'h-6 min-w-9 rounded-md px-1.5 text-xs shadow-none',
  md: 'h-11 min-w-13 rounded-[10px] px-1.5 text-xl',
  lg: 'h-13 min-w-15 rounded-card px-1.5 text-2xl shadow-[inset_0_-3px_0_rgb(0_0_0/0.15)]',
  xl: 'h-16 min-w-18 rounded-card px-2 text-[34px] shadow-[inset_0_-4px_0_rgb(0_0_0/0.15)]',
}

/** The bus "blind" tile: route number as the hero, teal (orange for premium routes). */
export function RouteTile({ route, variant = 'standard', size, className }: RouteTileProps) {
  return (
    <span
      data-variant={variant}
      className={cx(
        'flex shrink-0 items-center justify-center font-extrabold text-white tabular',
        size ? TILE_SIZE[size] : 'h-12 min-w-14 rounded-button px-2 text-xl shadow-card',
        variant === 'premium' ? 'bg-ferry-orange-aa' : 'bg-teal-text',
        className,
      )}
    >
      <span className="sr-only">Route </span>
      {route}
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

export interface ServiceTimelineProps {
  stops: TimelineStop[]
  color?: string
  /**
   * Where the train is, as a fractional row index (2.4 = 40% of the way from row 2 to row 3), or null when unknown.
   * Rendered as the orange capsule moving down the line.
   */
  position?: number | null
  /** Accessible description of the train's position, e.g. "Between Milton and Auchenflower". */
  positionLabel?: string
  label?: string
}

/** Service detail: vertical line in the line colour, one row per station, the train as a moving capsule. */
export function ServiceTimeline({
  stops,
  color,
  position = null,
  positionLabel,
  label = 'Stopping pattern',
}: ServiceTimelineProps) {
  const c = lineColourOf(color)
  const at = position == null ? -1 : Math.min(stops.length - 1, Math.max(0, Math.floor(position)))
  const frac = position == null ? 0 : Math.min(1, Math.max(0, position - at))
  return (
    <ol aria-label={label} className="flex flex-col">
      {stops.map((s, i) => {
        const passed = s.kind === 'passed'
        const muted = passed || s.kind === 'skip'
        const lineCol = passed ? '#C9D7E6' : c
        return (
          <li key={s.id} data-kind={s.kind} className="relative flex min-h-12 items-stretch gap-3">
            <span aria-hidden="true" className="relative flex w-6 shrink-0 justify-center">
              <span
                className="absolute left-1/2 w-1 -translate-x-1/2"
                style={{
                  background: lineCol,
                  top: i === 0 ? '50%' : 0,
                  bottom: i === stops.length - 1 ? '50%' : 0,
                }}
              />
              <span
                className={cx(
                  'relative box-border self-center rounded-full',
                  s.kind === 'skip' && 'size-3 border-2 bg-white',
                  s.kind === 'you' && 'size-5 border-[5px] border-ferry-orange-dark bg-white',
                  (s.kind === 'stop' || s.kind === 'passed' || s.kind === 'terminus') &&
                    'size-3.5 border-[3px] border-white',
                )}
                style={
                  s.kind === 'skip'
                    ? { borderColor: c }
                    : s.kind === 'you'
                      ? undefined
                      : { background: lineCol, boxShadow: `0 0 0 1px ${lineCol}` }
                }
              />
              {i === at ? (
                <span
                  data-train-position={position?.toFixed(2)}
                  className="absolute left-1/2 z-10 h-7.5 w-5.5 -translate-x-1/2 -translate-y-1/2 rounded-lg border-[3px] border-white bg-ferry-orange shadow-[0_0_0_2px_#FF6B35,0_0_14px_rgb(255_107_53/0.6)] transition-[top] duration-1000 motion-safe:animate-pulse"
                  style={{ top: `calc(50% + ${frac * 100}%)` }}
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center py-1">
              <span
                className={cx(
                  'text-[15px]',
                  muted ? 'font-medium text-sched-text' : 'font-bold text-charcoal dark:text-night-text',
                  s.cancelled && 'line-through',
                )}
              >
                {s.name}
              </span>
              {s.note ? (
                <span className="text-xs text-gray-600 dark:text-night-text/70">{s.note}</span>
              ) : null}
            </span>
            <span
              className={cx(
                'flex flex-col items-end justify-center text-sm font-bold tabular',
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
              ) : (
                <span>{s.dep ?? s.arr ?? '—'}</span>
              )}
              {s.delay ? <span className="text-xs font-semibold text-[#B45309]">{s.delay}</span> : null}
            </span>
          </li>
        )
      })}
      {positionLabel ? <li className="sr-only">{positionLabel}</li> : null}
    </ol>
  )
}
