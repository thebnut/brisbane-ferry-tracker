/**
 * Bus stops on the map picker (P3), lazy from SearchPanel. Stops come from the geohash-5 tiles covering the view
 * (zoom 13+, as /map; each tile fetched once a session and kept by the service worker), clustered by the picker.
 * The card's Save is "My stops" (storage.ts, unchanged), Open the stop page.
 */
import type { ViewBounds } from '@bft/ui/map'
import { writeMapPref } from '@bft/ui/map-toggle'
import StopPickerMap, { type PickerStop, toCardDepartures, useWide } from '@bft/ui/stop-picker-map'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { fetchDepartures } from '../lib/api.ts'
import { cellsCovering } from '../lib/geo.ts'
import { useGeoTiles } from '../lib/geo-queries.ts'
import { useApi } from '../lib/mode.ts'
import { stopHref } from '../lib/stops.ts'
import { toggleSaved, useSavedStops } from '../lib/storage.ts'

/** Tiles are loaded from this zoom; further out the picker asks to zoom in. */
const TILE_ZOOM = 13
/** At most this many tiles for one view (a desktop window at zoom 13). */
const MAX_TILES = 30

export default function BusStopPicker({
  slot,
  onClose,
}: {
  /** SearchPanel renders a slot in each layout; only the one for this screen width shows the picker. */
  slot: 'wide' | 'narrow'
  onClose: () => void
}) {
  const wide = useWide()
  const { mode, fetcher } = useApi()
  const [cells, setCells] = useState<string[]>([])
  const [zoomedOut, setZoomedOut] = useState(false)
  const tiles = useGeoTiles(fetcher, mode, cells)
  const saved = useSavedStops()
  const stops = useMemo<PickerStop[]>(
    () =>
      tiles.tiles.flatMap((t) =>
        t.stops.map((s) => ({ id: s.key, name: s.name, lat: s.lat, lon: s.lon, code: s.code })),
      ),
    [tiles.tiles],
  )
  const onView = useCallback((b: ViewBounds, zoom: number) => {
    const c = zoom >= TILE_ZOOM ? cellsCovering(b, 5, MAX_TILES) : null
    setZoomedOut(!c)
    if (c) setCells(c)
  }, [])
  const loadDepartures = useCallback(
    (s: PickerStop, signal: AbortSignal) =>
      fetchDepartures(fetcher, s.id, { limit: 3, signal }).then((r) => toCardDepartures(r.departures)),
    [fetcher],
  )
  if (wide !== (slot === 'wide')) return null
  const isSaved = (s: PickerStop) => saved.some((x) => x.id === s.id)
  const picker = (
    <StopPickerMap
      title="Bus stops"
      noun="stop"
      shape="diamond"
      stops={stops}
      onViewChange={onView}
      notice={
        zoomedOut ? 'Zoom in to see bus stops' : tiles.error ? 'Map data unavailable. Try again later.' : null
      }
      loadDepartures={loadDepartures}
      renderOpen={(s, className) => (
        <Link to={stopHref(s.id)} className={className}>
          Open
        </Link>
      )}
      save={{
        label: (s) => (isSaved(s) ? 'Saved' : 'Save'),
        pressed: isSaved,
        onClick: (s) => toggleSaved({ id: s.id, name: s.name }),
      }}
      onClose={() => {
        writeMapPref(false)
        onClose()
      }}
    />
  )
  return wide ? <div className="h-[70vh] min-w-0 flex-1">{picker}</div> : picker
}
