/**
 * Live ferry map (legacy FerryMapModal): pulsing dots for ferries on the selected pair's departures (express
 * red-orange, all-stops aqua) and the two terminals. Loaded lazily with MapLibre only when opened.
 */
import type { Departure } from '@bft/core/contract'
import { BottomSheet, vesselName } from '@bft/ui'
import MapView, { type MapMarker } from '@bft/ui/map'
import { useMemo } from 'react'
import type { ApiFetcher } from '../lib/api.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useVehicles } from '../lib/queries.ts'
import { type StopPair, terminalById } from '../lib/terminals.ts'

export interface LiveMapSheetProps {
  pair: StopPair
  departures: Departure[]
  fetcher: ApiFetcher
  mode: DataMode
  onClose: () => void
  onSelect: (d: Departure) => void
}

export default function LiveMapSheet({
  pair,
  departures,
  fetcher,
  mode,
  onClose,
  onSelect,
}: LiveMapSheetProps) {
  const vehicles = useVehicles(fetcher, mode, true)
  const byTrip = useMemo(() => new Map(departures.map((d) => [d.tripInstance, d])), [departures])
  const relevant = (vehicles.data?.vehicles ?? []).filter((v) => v.tripKey && byTrip.has(v.tripKey))
  const shown = relevant.length > 0 ? relevant : (vehicles.data?.vehicles ?? [])

  const markers: MapMarker[] = useMemo(() => {
    const terminals = [terminalById(pair.outbound.id), terminalById(pair.inbound.id)]
      .filter((t) => t != null)
      .map((t) => ({ id: t.id, lat: t.lat, lon: t.lng, tone: 'stop' as const, label: `${t.name} terminal` }))
    const ferries = shown.map((v) => {
      const d = v.tripKey ? byTrip.get(v.tripKey) : undefined
      const express = (d?.route.short ?? v.routeId?.split('-')[0]) === 'F11'
      return {
        id: v.id,
        lat: v.lat,
        lon: v.lon,
        pulse: true,
        tone: express ? ('express' as const) : ('allstops' as const),
        label: `${vesselName(v.id) ?? 'Ferry'}${express ? ' (express)' : ''}`,
        onClick: d ? () => onSelect(d) : undefined,
      }
    })
    return [...terminals, ...ferries]
  }, [shown, byTrip, pair, onSelect])

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Live ferry map"
      subtitle={
        <p className="text-sm text-gray-700">
          {relevant.length > 0
            ? `${relevant.length} ferr${relevant.length === 1 ? 'y' : 'ies'} between ${cleanStopName(pair.outbound.name)} and ${cleanStopName(pair.inbound.name)}`
            : vehicles.isPending
              ? 'Loading ferry positions…'
              : 'No ferries on this route right now. Showing all ferries with GPS.'}
        </p>
      }
    >
      <MapView
        markers={markers}
        fitTo={[pair.outbound.id, pair.inbound.id]}
        label="Map of live ferry positions"
        className="h-[60dvh] w-full overflow-hidden rounded-card bg-map-ground"
      />
      <p className="mt-2 flex gap-4 text-xs text-sched-text">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-full border-2 border-white bg-ferry-orange-dark shadow"
          />
          Express
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-full border-2 border-white bg-ferry-aqua shadow"
          />
          All stops
        </span>
      </p>
    </BottomSheet>
  )
}
