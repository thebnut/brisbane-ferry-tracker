/**
 * The map's safety net: a map that can't start must never take down the page. MapLibre 6 needs WebGL2 and throws on
 * start without it; uncaught, that reaches the route error boundary and replaces the whole page (stop list and all).
 * `MapBoundary` checks WebGL2 before the map's chunk is imported, catches anything the map throws on start or later
 * (or a chunk that fails to load), and shows a compact "Map unavailable" panel in the map's box instead.
 *
 * This module stays small and never imports maplibre-gl statically: `SafeMap` (the default export) is `MapView`
 * behind React.lazy inside a `MapBoundary`, so lazy-load this module (or import it from an already lazy chunk).
 */
import { Component, lazy, type ReactNode, Suspense, useEffect, useSyncExternalStore } from 'react'
import { cx } from '../cx.ts'
import type { MapViewProps } from './MapView.tsx'

// Client-only: the server never renders a map, and keeping MapLibre out of the Worker bundle keeps it small.
const MapView = lazy(() => (import.meta.env.SSR ? new Promise<never>(() => {}) : import('./MapView.tsx')))

/** MapView's own default box. */
const DEFAULT_BOX = 'h-80 w-full overflow-hidden rounded-card bg-map-ground'

let webgl2: boolean | undefined
/**
 * Whether this browser can start a map: MapLibre 6 asks for `webgl2` only (no WebGL1 fallback). Client-only (false
 * without a DOM); checked once on an offscreen canvas, whose context is released straight away, then cached.
 */
export function supportsWebGL(): boolean {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2')
      webgl2 = !!gl
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      webgl2 = false
    }
  }
  return webgl2
}

let warned = false
/** One console.warn per page load, whatever fails and however often. */
function warnOnce(reason: string, error?: unknown): void {
  if (warned) return
  warned = true
  console.warn(`Map unavailable: ${reason}`, ...(error === undefined ? [] : [error]))
}

/** The panel shown in the map's place: same box (`className`), so nothing below it moves. */
export function MapUnavailable({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      role="status"
      className={cx(
        className ?? DEFAULT_BOX,
        'flex flex-col items-center justify-center gap-1 bg-map-ground p-4 text-center text-charcoal',
      )}
    >
      <p className="text-sm font-semibold">Map unavailable on this device</p>
      <p className="text-xs text-sched-text">
        This browser can't draw the map (WebGL2 is off or not supported).
      </p>
      {children}
    </div>
  )
}

/** Set when any map fails to start: later mounts (a reopened sheet, a re-keyed map) show the panel, no retry. */
let failed = false

class Catch extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    failed = true
    warnOnce('the map failed to start', error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const noSubscribe = () => () => {}
const serverSnapshot = () => true

export interface MapBoundaryProps {
  /** The map's box: the loading placeholder and the unavailable panel take the same size. */
  className?: string
  /** While the map's chunk loads (default: a pulsing box). */
  loading?: ReactNode
  /** Extra content for the unavailable panel, e.g. a link to the list on a full-page map. */
  unavailable?: ReactNode
  children: ReactNode
}

/**
 * Error boundary plus Suspense around a lazy map. Without WebGL2 the children never render, so their lazy import
 * (and MapLibre) is never fetched. No retry: the panel stays until the page is reloaded.
 */
export function MapBoundary({ className, loading, unavailable, children }: MapBoundaryProps) {
  const ok = useSyncExternalStore(noSubscribe, supportsWebGL, serverSnapshot)
  useEffect(() => {
    if (!ok) warnOnce('WebGL2 is not available')
  }, [ok])
  const panel = <MapUnavailable className={className}>{unavailable}</MapUnavailable>
  if (!ok || failed) return panel
  return (
    <Catch fallback={panel}>
      <Suspense fallback={loading ?? <div className={cx(className ?? DEFAULT_BOX, 'animate-pulse')} />}>
        {children}
      </Suspense>
    </Catch>
  )
}

export type SafeMapProps = MapViewProps & Pick<MapBoundaryProps, 'loading' | 'unavailable'>

/** `MapView` (lazy) inside a `MapBoundary`: what every page should mount instead of `MapView` itself. */
export default function SafeMap({ loading, unavailable, ...props }: SafeMapProps) {
  return (
    <MapBoundary className={props.className} loading={loading} unavailable={unavailable}>
      <MapView {...props} />
    </MapBoundary>
  )
}
