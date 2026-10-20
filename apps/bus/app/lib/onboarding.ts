/**
 * First-visit onboarding (P4) for bus: the picker's stops and the save into "My stops" (`bft-bus-saved`, through
 * storage.ts toggleSaved, so the format, its SSR cookie and every open list stay as they are). Stops on the map come
 * from the geohash-5 tiles in view (zoom 13+, as BusStopPicker); the name search loads the stop index on first use.
 * Loaded only with the prompt (lazy).
 */
import type { TrayItem } from '@bft/ui/onboarding'
import type { ModeSource } from '@bft/ui/onboarding-picker'
import type { PickerStop } from '@bft/ui/stop-picker'
import { useCallback, useMemo, useState } from 'react'
import { cellsCovering } from './geo.ts'
import { useGeoTiles } from './geo-queries.ts'
import { useApi } from './mode.ts'
import { useStopIndex } from './queries.ts'
import { isSaved, KEYS, readSaved, toggleSaved } from './storage.ts'

const TILE_ZOOM = 13
const MAX_TILES = 30

export const busHasSaved = (): boolean => readSaved().length > 0

/** Adds the tray's bus stops to My stops, in tray order, after any already there. False if storage refused. */
export function saveBus(items: TrayItem[]): boolean {
  const stops = items.filter((i) => i.mode === 'bus')
  for (const s of stops) if (!isSaved(s.id)) toggleSaved({ id: s.id, name: s.name })
  // storage.ts keeps quiet when storage refuses, so read the store itself back.
  let stored: { id?: unknown }[] = []
  try {
    stored = JSON.parse(localStorage.getItem(KEYS.SAVED) ?? '[]')
  } catch {
    return false
  }
  return stops.every((s) => stored.some((x) => x?.id === s.id))
}

export function useBusSource(): ModeSource {
  const { mode, fetcher } = useApi()
  const [cells, setCells] = useState<string[]>([])
  const [zoomedOut, setZoomedOut] = useState(false)
  const [wantIndex, setWantIndex] = useState(false)
  const tiles = useGeoTiles(fetcher, mode, cells)
  const index = useStopIndex(fetcher, mode, wantIndex)
  const stops = useMemo<PickerStop[]>(
    () =>
      tiles.tiles.flatMap((t) =>
        t.stops.map((s) => ({ id: s.key, name: s.name, lat: s.lat, lon: s.lon, code: s.code })),
      ),
    [tiles.tiles],
  )
  const onViewChange = useCallback((b: Parameters<typeof cellsCovering>[0], zoom: number) => {
    const c = zoom >= TILE_ZOOM ? cellsCovering(b, 5, MAX_TILES) : null
    setZoomedOut(!c)
    if (c) setCells(c)
  }, [])
  const { index: idx, searchStops, isError } = index
  return {
    mode: 'bus',
    label: 'Bus',
    title: 'Bus stops',
    noun: 'stop',
    shape: 'diamond',
    stops,
    onViewChange,
    notice: zoomedOut
      ? 'Zoom in to see bus stops'
      : tiles.error
        ? 'Map data unavailable. Try again later.'
        : null,
    prepareSearch: () => setWantIndex(true),
    searching: wantIndex && !idx && !isError,
    search: (q) =>
      idx && searchStops
        ? searchStops(idx, q, 8).hits.map((e) => ({
            id: e.key,
            name: e.name,
            lat: e.lat,
            lon: e.lon,
            code: e.code,
          }))
        : [],
  }
}
