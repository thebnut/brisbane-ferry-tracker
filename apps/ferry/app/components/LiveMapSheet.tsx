/**
 * Live ferry map (legacy FerryMapModal): pulsing dots for ferries on the selected pair's departures (express
 * red-orange, all-stops aqua) and the two terminals. Loaded lazily with MapLibre only when opened.
 */
import type { Departure } from '@bft/core/contract'
import { BottomSheet, vesselName } from '@bft/ui'
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import type { ApiFetcher } from '../lib/api.ts'
import { cleanStopName } from '../lib/names.ts'
import type { DataMode } from '../lib/queries.ts'
import { type StopChoice, terminalById } from '../lib/terminals.ts'
import { useVehicles } from '../lib/vehicles.ts'

export interface LiveMapSheetProps {
  /** The board's terminal and its "To" (none: every ferry from it). */
  from: StopChoice
  to: StopChoice | null
  /** false when the boards are offline/stale: positions are not shown. */
  live: boolean
  departures: Departure[]
  fetcher: ApiFetcher
  mode: DataMode
  onClose: () => void
  onSelect: (d: Departure) => void
}

export default function LiveMapSheet({
  from,
  to,
  live,
  departures,
  fetcher,
  mode,
  onClose,
  onSelect,
}: LiveMapSheetProps) {
  const vehicles = useVehicles(fetcher, mode, true)
  const byTrip = useMemo(() => new Map(departures.map((d) => [d.tripInstance, d])), [departures])
  const positions = live && vehicles.data?.rtState === 'live' ? vehicles.data.vehicles : []
  const relevant = positions.filter((v) => v.tripKey && byTrip.has(v.tripKey))
  const shown = relevant.length > 0 ? relevant : positions

  const markers: MapMarker[] = useMemo(() => {
    const terminals = [terminalById(from.id), to ? terminalById(to.id) : null]
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
  }, [shown, byTrip, from, to, onSelect])

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Live ferry map"
      subtitle={
        <p className="text-sm text-gray-700">
          {!live || (vehicles.data && vehicles.data.rtState !== 'live')
            ? 'Live positions are unavailable right now.'
            : relevant.length > 0
              ? `${relevant.length} ferr${relevant.length === 1 ? 'y' : 'ies'} ${to ? `between ${cleanStopName(from.name)} and ${cleanStopName(to.name)}` : `from ${cleanStopName(from.name)}`}`
              : vehicles.isPending
                ? 'Loading ferry positions…'
                : 'No ferries on this route right now. Showing all ferries with GPS.'}
        </p>
      }
    >
      <SafeMap
        markers={markers}
        fitTo={to ? [from.id, to.id] : [from.id]}
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
