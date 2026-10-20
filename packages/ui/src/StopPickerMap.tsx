/**
 * Map stop picker (P3), shared by bus, train and ferry (`@bft/ui/stop-picker-map`, default export). Always behind
 * React.lazy: it pulls in MapLibre (`@bft/ui/map`), which must never be on a first load.
 *
 * A full-screen sheet on phones and a panel beside the list at md+ (the caller sizes it). The mode's stops show as
 * pins, grouped into clusters until zoom 16 (stop-picker.ts); a tap opens the stop's card with its next departures
 * (loaded only then) and the mode's own Open and Save actions. "Stops in view" lists the same stops as buttons, the
 * keyboard and screen-reader path. Single-select only: P4's multi-select tray extends `PickerSelection`.
 */
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import {
  Component,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { formatClock, minutesUntil } from './format.ts'
import { useGeolocation } from './geolocation.ts'
import { Icon } from './icons.tsx'
import MapView, { type MapMarker, type PinShape, type ViewBounds } from './map/MapView.tsx'
import {
  CBD_CENTRE,
  CLUSTER_MAX_ZOOM,
  clusterStops,
  initialSelection,
  type PickerCluster,
  type PickerStop,
  selectionReducer,
  viewAround,
  visibleStops,
} from './stop-picker.ts'

export type { PickerStop } from './stop-picker.ts'

/** A departure on the stop card, already reduced from the mode's API answer. */
export interface CardDeparture {
  id: string
  /** Route short name or line, e.g. "66", "Ferny Grove", "F1". */
  route: string
  headsign: string
  /** Epoch seconds: the live estimate when there is one, else the timetable. */
  dep: number
  platform?: string | null
}

export interface StopPickerMapProps {
  /** "Bus stops", "Train stations", "Ferry terminals". */
  title: string
  /** Singular noun for counts and labels: "stop", "station", "terminal". */
  noun: string
  stops: PickerStop[]
  shape: PinShape
  /** P3 is single-select; P4 adds 'multi'. */
  mode?: 'single'
  /** The map's view after each move, for callers that load stops by area (bus geo tiles). */
  onViewChange?: (bounds: ViewBounds, zoom: number) => void
  /** A line over the map, e.g. "Zoom in to see bus stops" or "Map data unavailable". */
  notice?: string | null
  /** Next departures for the card, fetched when a stop is tapped (never prefetched). */
  loadDepartures: (stop: PickerStop, signal: AbortSignal) => Promise<CardDeparture[]>
  /** The "Open" link to the stop's page, in the app's router (className styles it as a button). */
  renderOpen: (stop: PickerStop, className: string) => ReactNode
  /** The second action: Save (toggle in the mode's store) or the ferry's "Use as From". */
  save: {
    label: (stop: PickerStop) => string
    pressed?: (stop: PickerStop) => boolean
    onClick: (stop: PickerStop) => void
  }
  onClose: () => void
  zoom?: number
  className?: string
}

/** WebGL 2, which MapLibre 6 needs; without it the map can't start (R13-R1). */
export function supportsWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/**
 * Catches a map that fails anyway (a lost or blocked WebGL context), so the picker shows its fallback instead of the
 * error taking down the page. To be reconciled with the shared map boundary from fix/map-no-webgl when it lands.
 */
export class MapBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Tab and Shift+Tab wrap inside the modal picker (as BottomSheet's wrapTabFocus; not imported from there, because a new
 * export from the shared chunk would grow every page's first load).
 */
function wrapTab(e: KeyboardEvent<HTMLElement>) {
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.getClientRects().length > 0)
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

const CLUSTER_SOURCE = 'bft-picker-clusters'
const ACTION =
  'flex min-h-11 flex-1 items-center justify-center rounded-button px-4 text-sm font-bold transition active:scale-95'

function clusterData(clusters: PickerCluster[]): Parameters<GeoJSONSource['setData']>[0] {
  return {
    type: 'FeatureCollection',
    features: clusters.map((c) => ({
      type: 'Feature',
      properties: { id: c.id, count: c.count, ...c.bounds },
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
    })),
  }
}

/** Cluster circles with their counts; a tap zooms to the cluster's stops. */
function addClusterLayers(m: MlMap) {
  m.addSource(CLUSTER_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({
    id: CLUSTER_SOURCE,
    type: 'circle',
    source: CLUSTER_SOURCE,
    paint: {
      'circle-color': '#1E7C80',
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'count'], 14, 10, 17, 50, 21, 200, 25],
    },
  })
  m.addLayer({
    id: `${CLUSTER_SOURCE}-count`,
    type: 'symbol',
    source: CLUSTER_SOURCE,
    layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#FFFFFF' },
  })
  m.on('click', CLUSTER_SOURCE, (e) => {
    const p = e.features?.[0]?.properties as
      | { west: number; south: number; east: number; north: number }
      | undefined
    if (!p) return
    m.fitBounds(
      [
        [p.west, p.south],
        [p.east, p.north],
      ],
      { padding: 64, maxZoom: CLUSTER_MAX_ZOOM, minZoom: Math.min(m.getZoom() + 1, CLUSTER_MAX_ZOOM) },
    )
  })
  m.on('mouseenter', CLUSTER_SOURCE, () => {
    m.getCanvas().style.cursor = 'pointer'
  })
  m.on('mouseleave', CLUSTER_SOURCE, () => {
    m.getCanvas().style.cursor = ''
  })
}

/** "now", "4 min", "1 hr 5 min" (spelled here: a new import from the shared chunk would grow every first load). */
const countdown = (m: number) =>
  m < 1 ? 'now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`

function Departures({ stop, load }: { stop: PickerStop; load: StopPickerMapProps['loadDepartures'] }) {
  const [state, setState] = useState<{ id: string; rows: CardDeparture[] | null; error: boolean }>({
    id: stop.id,
    rows: null,
    error: false,
  })
  const args = useRef({ stop, load })
  args.current = { stop, load }
  // biome-ignore lint/correctness/useExhaustiveDependencies: one request per tapped stop, not per re-render.
  useEffect(() => {
    // A newer tap aborts this request, and an answer for another stop is ignored.
    const ctl = new AbortController()
    const { stop, load } = args.current
    setState({ id: stop.id, rows: null, error: false })
    load(stop, ctl.signal).then(
      (rows) => {
        if (!ctl.signal.aborted) setState({ id: stop.id, rows: rows.slice(0, 3), error: false })
      },
      () => {
        if (!ctl.signal.aborted) setState({ id: stop.id, rows: null, error: true })
      },
    )
    return () => ctl.abort()
  }, [stop.id])
  const now = Date.now()
  if (state.id !== stop.id || (!state.rows && !state.error))
    return <p className="text-sm text-sched-text">Loading departures…</p>
  if (state.error || !state.rows)
    return <p className="text-sm text-sched-text">Departures unavailable right now.</p>
  if (state.rows.length === 0) return <p className="text-sm text-sched-text">No departures soon.</p>
  return (
    <ul aria-label={`Next departures from ${stop.name}`} className="flex flex-col gap-1">
      {state.rows.map((d) => (
        <li key={d.id} className="flex items-baseline gap-2 text-sm">
          <span className="min-w-10 rounded bg-ferry-orange-light px-1.5 text-center font-bold text-ferry-orange-deep dark:bg-night-2 dark:text-ferry-sunset">
            {d.route}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {d.headsign}
            {d.platform ? <span className="text-sched-text"> · platform {d.platform}</span> : null}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {formatClock(d.dep)}{' '}
            <span className="font-normal text-sched-text">{countdown(minutesUntil(d.dep, now))}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function StopPickerMap({
  title,
  noun,
  stops,
  shape,
  onViewChange,
  notice,
  loadDepartures,
  renderOpen,
  save,
  onClose,
  zoom = 15,
  className,
}: StopPickerMapProps) {
  const { geo } = useGeolocation()
  const [selection, dispatch] = useReducer(selectionReducer, undefined, initialSelection)
  const [view, setView] = useState<{ bounds: ViewBounds; zoom: number } | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [webgl] = useState(supportsWebGL)
  const map = useRef<MlMap | null>(null)
  const pendingFly = useRef<{ center: [number, number]; zoom: number } | null>(null)
  // A located device remounts the map (its key): the old map is gone until the new one is ready, so list picks wait
  // for it (pendingFly) instead of moving the removed map (Codex review).
  const mapKey = geo.state === 'ok' ? 'located' : 'default'
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the map is replaced (mapKey) and on unmount.
  useEffect(
    () => () => {
      map.current = null
    },
    [mapKey],
  )
  const closeRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // On phones the picker covers the page: a modal dialog, with the page behind it inert (Codex review). On desktop it
  // sits beside the list, and a caller's own layout (the ferry selector's sheet) is already modal.
  const wide = useWide()
  const modal = !className && !wide
  useEffect(() => {
    const root = sectionRef.current
    if (!modal || !root) return
    const made: Element[] = []
    for (let el: Element | null = root; el?.parentElement && el !== document.body; el = el.parentElement)
      for (const sib of el.parentElement.children)
        if (sib !== el && !sib.hasAttribute('inert')) {
          sib.setAttribute('inert', '')
          made.push(sib)
        }
    return () => {
      for (const sib of made) sib.removeAttribute('inert')
    }
  }, [modal])
  const cardRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLButtonElement>(null)
  /** Closing the card keeps focus in the picker (on the list button), so Escape and Tab still work there. */
  const closeCard = () => {
    dispatch({ type: 'close' })
    listRef.current?.focus()
  }
  const byId = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])
  const active = selection.active ? (byId.get(selection.active) ?? null) : null

  const grouped = useMemo(
    () => (view ? clusterStops(stops, view.bounds, view.zoom) : { stops: [], clusters: [] }),
    [stops, view],
  )
  const inView = useMemo(() => (view ? visibleStops(stops, view.bounds) : []), [stops, view])

  useEffect(() => {
    ;(map.current?.getSource(CLUSTER_SOURCE) as GeoJSONSource | undefined)?.setData(
      clusterData(grouped.clusters),
    )
  }, [grouped])
  // Focus moves into the picker, and back to what opened it (the Map button) when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  // Focus follows the card: the keyboard list (whose button it came from) closes, and Escape must reach the picker.
  const activeId = active?.id
  useEffect(() => {
    if (activeId) cardRef.current?.focus()
  }, [activeId])

  const onReady = useCallback((m: MlMap) => {
    map.current = m
    addClusterLayers(m)
    // A stop chosen from the list before the map had loaded: centre on it now.
    if (pendingFly.current) m.jumpTo(pendingFly.current)
    pendingFly.current = null
  }, [])
  const onView = (bounds: ViewBounds, z: number) => {
    setView({ bounds, zoom: z })
    onViewChange?.(bounds, z)
  }
  const pick = (s: PickerStop, fly: boolean) => {
    dispatch({ type: 'tap', id: s.id })
    setListOpen(false)
    if (!fly) return
    const m = map.current
    if (m) m.easeTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), CLUSTER_MAX_ZOOM) })
    else pendingFly.current = { center: [s.lon, s.lat], zoom: CLUSTER_MAX_ZOOM }
  }

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = []
    if (geo.state === 'ok')
      out.push({ id: 'me', lat: geo.lat, lon: geo.lon, tone: 'you', pulse: true, label: 'You are here' })
    if (active)
      out.push({
        id: `sel:${active.id}`,
        lat: active.lat,
        lon: active.lon,
        shape,
        tone: 'selected',
        label: active.name,
      })
    return out
  }, [geo, active, shape])
  const center: [number, number] = geo.state === 'ok' ? [geo.lon, geo.lat] : CBD_CENTRE
  // The view the map opens on, from its box, until MapLibre reports its own (after the basemap loads, which can take a
  // while on a busy device): the stops list, clusters and bus tiles don't wait for the basemap.
  const mapBox = useRef<HTMLDivElement>(null)
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const [cLon, cLat] = center
  useEffect(() => {
    const box = mapBox.current
    if (box?.clientWidth && box.clientHeight)
      onViewRef.current(viewAround([cLon, cLat], zoom, box.clientWidth, box.clientHeight), zoom)
  }, [cLon, cLat, zoom])
  const meta = active
    ? [active.code ? `${noun === 'stop' ? 'Stop' : 'Code'} ${active.code}` : null, active.detail]
        .filter(Boolean)
        .join(' · ')
    : ''

  // The list and search stay usable: the picker is only ever an addition to them.
  const unavailable = (
    <div
      role="status"
      className="flex h-full flex-col items-center justify-center gap-1.5 bg-map-ground p-6 text-center"
    >
      <p className="font-bold">Map unavailable on this device</p>
      <p className="text-sm text-sched-text">Close the map and search for a {noun} by name instead.</p>
    </div>
  )

  return (
    <section
      ref={sectionRef}
      aria-label={`${title} map`}
      // A dialog on phones (covers the page), a region beside the list on desktop.
      {...(modal ? { role: 'dialog', 'aria-modal': true } : {})}
      data-stop-picker=""
      onKeyDown={(e) => {
        if (modal && e.key === 'Tab') return wrapTab(e)
        if (e.key !== 'Escape') return
        // Inside a modal sheet (ferry), Escape steps back in the picker instead of closing the sheet.
        e.preventDefault()
        e.stopPropagation()
        if (listOpen) {
          // The focused stop button goes with the list: keep focus in the picker (Codex review).
          setListOpen(false)
          listRef.current?.focus()
        } else if (active) closeCard()
        else onClose()
      }}
      className={
        className ??
        'bg-page fixed inset-0 z-50 flex flex-col md:relative md:inset-auto md:z-auto md:h-full md:overflow-hidden md:rounded-card md:border md:border-ferry-orange/20'
      }
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-extrabold">{title}</h2>
        <button
          ref={listRef}
          type="button"
          aria-expanded={listOpen}
          aria-controls="bft-picker-list"
          onClick={() => setListOpen((o) => !o)}
          className="min-h-11 rounded-full border border-ferry-orange/30 bg-white px-3.5 text-sm font-semibold text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light"
        >
          {noun[0]?.toUpperCase()}
          {noun.slice(1)}s in view ({inView.length})
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={`Close the ${noun} map`}
          className="flex size-11 items-center justify-center rounded-full border border-ferry-orange/30 bg-white text-charcoal dark:bg-night-card dark:text-night-text"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div ref={mapBox} className="relative min-h-0 flex-1">
        {webgl ? (
          <MapBoundary fallback={unavailable}>
            <MapView
              markers={markers}
              fitTo={[]}
              stops={grouped.stops}
              stopShape={shape}
              onStopClick={(id) => {
                const s = byId.get(id)
                if (s) pick(s, false)
              }}
              onViewChange={onView}
              onReady={onReady}
              center={center}
              zoom={zoom}
              key={mapKey}
              label={`Map of ${inView.length} ${noun}s in view. Use “${noun[0]?.toUpperCase()}${noun.slice(1)}s in view” for a list.`}
              className="h-full w-full bg-map-ground"
            />
          </MapBoundary>
        ) : (
          unavailable
        )}
        {listOpen ? (
          <div
            id="bft-picker-list"
            className="absolute inset-x-2 top-2 z-10 max-h-[60%] overflow-y-auto rounded-card bg-white p-1.5 shadow-header dark:bg-night-card"
          >
            {inView.length === 0 ? (
              <p className="px-2 py-2 text-sm text-sched-text">
                No {noun}s in view. Zoom out or move the map.
              </p>
            ) : (
              <ul aria-label={`${title} in view`} className="flex flex-col">
                {inView.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => pick(s, true)}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-button px-2.5 text-left text-sm hover:bg-ferry-orange-light dark:hover:bg-night-2"
                    >
                      <span className="truncate font-semibold">{s.name}</span>
                      {s.code ? <span className="shrink-0 text-xs text-sched-text">{s.code}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="absolute inset-x-0 bottom-4 z-10 mx-auto w-fit rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-charcoal shadow-card dark:bg-night-card dark:text-night-text"
          >
            {notice}
          </p>
        ) : null}
        {active ? (
          <div
            ref={cardRef}
            tabIndex={-1}
            role="dialog"
            aria-label={active.name}
            data-stop-card={active.id}
            className="absolute inset-x-2 bottom-2 z-20 flex flex-col gap-2.5 rounded-card bg-white p-3.5 shadow-header md:right-auto md:w-[min(24rem,calc(100%-1rem))] dark:bg-night-card"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-extrabold">{active.name}</h3>
                {meta ? <p className="text-xs text-sched-text">{meta}</p> : null}
              </div>
              <button
                type="button"
                onClick={closeCard}
                aria-label={`Close ${active.name}`}
                className="-mt-1 -mr-1 flex size-10 items-center justify-center rounded-full text-sched-text"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <Departures stop={active} load={loadDepartures} />
            <div className="flex gap-2">
              {renderOpen(active, `${ACTION} bg-ferry-orange-aa text-white hover:bg-ferry-orange-deep`)}
              <button
                type="button"
                aria-pressed={save.pressed ? save.pressed(active) : undefined}
                onClick={() => save.onClick(active)}
                className={`${ACTION} border-2 border-ferry-orange bg-white text-ferry-orange-deep hover:bg-ferry-orange-light dark:bg-night-card dark:text-ferry-sunset`}
              >
                {save.label(active)}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** The card's rows from a `/v1` departures answer (any mode): the live estimate when there is one. */
export function toCardDepartures(
  departures: ReadonlyArray<{
    tripInstance: string
    route: { short: string }
    headsign: string
    schedDep: number
    estDep: number | null
    platform: string | null
  }>,
): CardDeparture[] {
  return departures.map((d) => ({
    id: d.tripInstance,
    route: d.route.short,
    headsign: d.headsign,
    dep: d.estDep ?? d.schedDep,
    platform: d.platform,
  }))
}

/** True at md+ (768 px), where the picker sits beside the list instead of covering the screen. */
export function useWide(): boolean {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(query)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}
