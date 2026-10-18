/** Train and bus elements restyled in the ferry look: platform tile, route tile, stopping-pattern strip. */
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
        className="flex size-14 shrink-0 flex-col items-center justify-center rounded-card bg-ferry-orange-dark text-white shadow-card"
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

export interface RouteTileProps {
  route: string
  /** Metro, CityGlider and BUZ routes use the orange tile. */
  variant?: 'standard' | 'premium'
}

const PREMIUM = /^(M\d+|GLIDER|G\d+|BUZ)/i

/** Bus routes that get the orange tile: Brisbane Metro (M1, M2) and the CityGlider routes. */
export function routeTileVariant(route: string, routeLong?: string): 'standard' | 'premium' {
  if (PREMIUM.test(route)) return 'premium'
  if (routeLong && /cityglider|metro/i.test(routeLong)) return 'premium'
  return 'standard'
}

export function RouteTile({ route, variant = 'standard' }: RouteTileProps) {
  return (
    <span
      data-variant={variant}
      className={cx(
        'flex h-12 min-w-14 shrink-0 items-center justify-center rounded-button px-2 text-xl font-extrabold text-white tabular shadow-card',
        variant === 'premium' ? 'bg-ferry-orange-dark' : 'bg-teal-text',
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
}

export interface StoppingPatternProps {
  stops: PatternStop[]
  /** Line colour (hex without #) from route data; defaults to aqua. */
  color?: string
  /** Visually show at most this many names; the rest are still in the accessible list. */
  label?: string
}

/** Dots on a line in the line's colour; hollow dots for stations an express runs through. */
export function StoppingPattern({ stops, color, label = 'Stopping pattern' }: StoppingPatternProps) {
  if (stops.length === 0) return null
  const lineColour = color ? `#${color}` : 'var(--color-ferry-aqua)'
  return (
    <ol
      aria-label={label}
      className="relative flex items-start justify-between gap-1 overflow-x-auto pt-1 pb-0.5"
    >
      <span
        aria-hidden="true"
        className="absolute top-[11px] right-2 left-2 h-[3px] rounded-full"
        style={{ background: lineColour }}
      />
      {stops.map((s) => (
        <li key={s.id} className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-1">
          <span
            aria-hidden="true"
            className="size-3.5 rounded-full border-[3px] bg-white"
            style={{ borderColor: lineColour, background: s.stops ? lineColour : '#fff' }}
          />
          <span
            className={cx(
              'max-w-full truncate text-center text-[10px] leading-tight',
              s.stops ? 'font-semibold text-charcoal dark:text-night-text' : 'text-sched-text',
            )}
          >
            {s.name}
            {s.stops ? null : <span className="sr-only"> (runs through)</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
