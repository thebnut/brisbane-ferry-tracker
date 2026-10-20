/**
 * Per-stop map (lazy): the stop as a bus diamond and the live buses on their way to it (pulsing dots, orange for
 * premium routes). MapLibre loads only when the map is opened.
 */
import type { Departure } from '@bft/core/contract'
import { routeTileVariant } from '@bft/ui'
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import { useApi } from '../lib/mode.ts'
import { useStopIndex } from '../lib/queries.ts'
import { useVehicles } from '../lib/vehicles.ts'

export default function StopMap({
  stopId,
  name,
  departures,
}: {
  stopId: string
  name: string
  departures: Departure[]
}) {
  const { mode, fetcher } = useApi()
  const { byKey } = useStopIndex(fetcher, mode, true)
  const vehicles = useVehicles(fetcher, mode, null)
  const stop = byKey.get(stopId)
  const markers = useMemo(() => {
    const byTrip = new Map(departures.map((d) => [d.tripInstance, d]))
    const out: MapMarker[] = []
    for (const v of vehicles.data?.vehicles ?? []) {
      const d = v.tripKey ? byTrip.get(v.tripKey) : undefined
      if (!d) continue
      out.push({
        id: v.id,
        lat: v.lat,
        lon: v.lon,
        shape: 'circle',
        pulse: true,
        tone: routeTileVariant(d.route.short, d.route.long) === 'premium' ? 'express' : 'allstops',
        label: `Route ${d.route.short} to ${d.headsign}`,
      })
    }
    if (stop)
      out.push({
        id: `stop:${stopId}`,
        lat: stop.lat,
        lon: stop.lon,
        shape: 'diamond',
        tone: 'selected',
        label: name,
      })
    return out
  }, [vehicles.data, departures, stop, stopId, name])
  const busCount = markers.length - (stop ? 1 : 0)
  return (
    <div className="flex flex-col gap-1.5">
      <SafeMap
        markers={markers}
        fitTo={stop ? [`stop:${stopId}`] : undefined}
        label={`Map of ${name} with ${busCount} live buses heading here`}
        className="h-72 w-full overflow-hidden rounded-card bg-map-ground md:h-96"
        zoom={15}
        center={stop ? [stop.lon, stop.lat] : undefined}
      />
      <p className="text-xs text-sched-text">
        {busCount === 1 ? '1 live bus' : `${busCount} live buses`} on the way · positions refresh every 15 s
      </p>
    </div>
  )
}
