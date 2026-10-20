/**
 * "Around you" map (lazy: MapLibre is never on the first-load path). Stops as mode pin shapes (ferry circle, train
 * square, bus diamond) and your position.
 */
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import type { NearStop } from '../lib/nearby.ts'

const SHAPE = { ferry: 'circle', train: 'square', bus: 'diamond' } as const

export default function NearbyMap({
  lat,
  lon,
  stops,
  onStop,
}: {
  lat: number
  lon: number
  stops: NearStop[]
  onStop: (s: NearStop) => void
}) {
  const markers = useMemo<MapMarker[]>(
    () => [
      ...stops.map((s) => ({
        id: `${s.mode}:${s.key}`,
        lat: s.lat,
        lon: s.lon,
        shape: SHAPE[s.mode],
        tone: s.mode,
        label: s.name,
        onClick: () => onStop(s),
      })),
      { id: 'you', lat, lon, shape: 'circle', tone: 'you', pulse: true, label: 'You are here' },
    ],
    [stops, lat, lon, onStop],
  )
  return (
    <SafeMap
      markers={markers}
      label={`Map of ${stops.length} stops around you`}
      className="h-64 w-full overflow-hidden rounded-card bg-map-ground md:h-80"
      center={[lon, lat]}
      zoom={15}
    />
  )
}
