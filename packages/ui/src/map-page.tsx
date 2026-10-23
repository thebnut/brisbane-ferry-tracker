/**
 * One map page per mode (THE-118 PR 9, `@bft/ui/map-page`): /ferry/map, /train/map and /bus/map. The map fills the
 * screen below the header and above the phone's bottom bar; the page's controls sit top left (the map's own locate-me
 * button is top right), a status pill and the selected vehicle's card at the bottom, and a legend with the mode's pin
 * shape (Nearby's spec: circle for ferry, square for train, diamond for bus). Only the map routes import this, and
 * MapLibre stays behind SafeMap's lazy import.
 */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './cx.ts'

export type PinShape = 'circle' | 'square' | 'diamond'

/** The map's own box inside the shell. */
export const MAP_BOX = 'h-full w-full bg-map-ground'

export interface LegendItem {
  label: string
  /** A vehicle (filled: express or all stops) or a stop/terminal/station (white with a teal border). */
  tone: 'express' | 'vehicle' | 'stop'
}

const SWATCH: Record<LegendItem['tone'], string> = {
  express: 'bg-ferry-orange-dark border-2 border-white',
  vehicle: 'bg-ferry-aqua border-2 border-white',
  stop: 'bg-white border-[3px] border-teal-text',
}
const SHAPE: Record<PinShape, string> = {
  circle: 'rounded-full',
  square: 'rounded-[3px]',
  diamond: 'rotate-45 scale-[0.8] rounded-[2px]',
}

/** The key: one swatch per kind of pin, drawn in the mode's shape. */
export function MapLegend({
  shape,
  items,
  children,
}: {
  shape: PinShape
  items: LegendItem[]
  children?: ReactNode
}) {
  return (
    <div
      data-map-legend={shape}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-charcoal shadow-card dark:bg-night-card dark:text-night-text"
    >
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cx('size-3 shrink-0 shadow', SWATCH[i.tone], SHAPE[shape])} />
          {i.label}
        </span>
      ))}
      {children}
    </div>
  )
}

export interface MapPageShellProps {
  mode: 'ferry' | 'train' | 'bus'
  /** The page's heading, for screen readers (the map is the page). */
  title: string
  /** Is there a bottom bar below the page on phones (the Mode Tabs, or a standalone app's section nav)? */
  bottomBar: boolean
  /** Top left over the map: the page's own filters. */
  controls?: ReactNode
  /** Bottom left: the legend. */
  legend?: ReactNode
  /** A short status over the map ("Zoom in to see bus stops", "Live positions are unavailable right now."). */
  status?: ReactNode
  /** The selected vehicle's card, at the bottom over the legend. */
  card?: ReactNode
  /** The map (SafeMap with `className={MAP_BOX}`), rendered after hydration. */
  children: ReactNode
}

/**
 * The full-bleed page. Its top is measured (headers differ by app, and a demo notice can sit above), so the map ends
 * at the bottom of the screen, or above the phone's bottom bar, and the page doesn't scroll.
 */
export function MapPageShell({
  mode,
  title,
  bottomBar,
  controls,
  legend,
  status,
  card,
  children,
}: MapPageShellProps) {
  const ref = useRef<HTMLElement>(null)
  // The map only after hydration: the server never renders one (SafeMap's lazy map never resolves there).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () =>
      el.style.setProperty('--map-top', `${el.getBoundingClientRect().top + window.scrollY}px`)
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [])
  return (
    <main
      ref={ref}
      data-map-page={mode}
      className={cx(
        'relative w-full overflow-hidden',
        bottomBar
          ? 'h-[calc(100dvh-var(--map-top,64px)-var(--bft-bottom-bar,58px)-max(env(safe-area-inset-bottom),6px))] md:h-[calc(100dvh-var(--map-top,64px))]'
          : 'h-[calc(100dvh-var(--map-top,64px))]',
      )}
    >
      <h1 className="sr-only">{title}</h1>
      {mounted ? (
        children
      ) : (
        <div className={cx(MAP_BOX, 'animate-pulse')} role="status" aria-label="Loading map" />
      )}
      {controls ? (
        // Left of the map's locate-me button (top right, 44 px): long place names wrap instead of reaching it. Only the
        // controls themselves take taps; the map stays draggable between them.
        <div className="pointer-events-none absolute top-3 right-16 left-3 z-10 flex flex-wrap items-center gap-2 *:pointer-events-auto">
          {controls}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col items-start gap-2 md:right-auto md:max-w-md">
        {status ? (
          <p
            role="status"
            className="pointer-events-auto flex w-fit items-center gap-3 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-charcoal shadow-card dark:bg-night-card dark:text-night-text"
          >
            {status}
          </p>
        ) : null}
        {card ? <div className="pointer-events-auto w-full">{card}</div> : null}
        {legend ? <div className="pointer-events-auto">{legend}</div> : null}
      </div>
    </main>
  )
}

/** The selected vehicle: what it is, where it's going, and a link to its trip. */
export function MapCard({ children }: { children: ReactNode }) {
  return (
    <div
      data-map-card=""
      className="rounded-card bg-white/95 p-3.5 shadow-header dark:bg-night-card"
      role="status"
    >
      {children}
    </div>
  )
}
