/** Per-route map (lazy): the line in the route colour, its stops as bus diamonds, live buses as pulsing dots. */
import type { Vehicle } from '@bft/core/contract'
import type { MapMarker, MapStop } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { RouteFile } from '../lib/data-contract.ts'
import { stopHref } from '../lib/stops.ts'

export default function RouteMap({
  pattern,
  vehicles,
  selectedTrip,
  color,
  variant,
}: {
  pattern: RouteFile['patterns'][number]
  vehicles: Vehicle[]
  selectedTrip: string | null
  color?: string
  variant: 'standard' | 'premium'
}) {
  const navigate = useNavigate()
  const line = useMemo(() => pattern.stops.map((s): [number, number] => [s.lon, s.lat]), [pattern])
  const stops = useMemo(
    () => pattern.stops.map((s): MapStop => ({ id: s.key, lat: s.lat, lon: s.lon, name: s.name })),
    [pattern],
  )
  const markers = useMemo(
    () =>
      vehicles.map(
        (v): MapMarker => ({
          id: v.id,
          lat: v.lat,
          lon: v.lon,
          shape: 'circle',
          pulse: true,
          tone:
            v.tripKey && v.tripKey === selectedTrip
              ? 'selected'
              : variant === 'premium'
                ? 'express'
                : 'allstops',
          label: `Bus${v.label ? ` ${v.label}` : ''}`,
        }),
      ),
    [vehicles, selectedTrip, variant],
  )
  // GTFS route colours are often pale; the line uses the teal tile colour unless the route colour is dark enough.
  const dark =
    color &&
    Number.parseInt(color.slice(0, 2), 16) * 0.3 +
      Number.parseInt(color.slice(2, 4), 16) * 0.59 +
      Number.parseInt(color.slice(4), 16) * 0.11 <
      140
  return (
    <SafeMap
      markers={markers}
      stops={stops}
      onStopClick={(id) => navigate(stopHref(id))}
      line={line}
      lineColor={dark ? color : variant === 'premium' ? 'C2410C' : '1E7C80'}
      label={`Map of route stops towards ${pattern.headsign} with ${markers.length} live buses`}
      className="h-80 w-full overflow-hidden rounded-card bg-map-ground md:h-[28rem]"
    />
  )
}
