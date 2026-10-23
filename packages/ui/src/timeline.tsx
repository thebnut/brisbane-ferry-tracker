/** The train trip page's elements (only it loads them, THE-118 PR 4): the platform tile and the live timeline. */
import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export const __x = 0
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

const lineColourOf = (color?: string) => (color ? `#${color}` : 'var(--color-ferry-aqua)')

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
