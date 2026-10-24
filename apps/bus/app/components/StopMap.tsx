/**
 * Per-stop map (lazy): the stop as a bus diamond and the live buses on their way to it (pulsing dots, orange for
 * premium routes). MapLibre loads only when the map is opened.
 *
 * Positions are live claims: shown only while the board is live and the positions' own answer is live and fresh
 * (shared liveState) with no failed request since, never from a copy kept after a failed refresh. Otherwise the stop alone, and a plain status.
 */
import type { Departure } from '@bft/core/contract'
import { routeTileVariant } from '@bft/ui'
import { liveState, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import { useApi } from '../lib/mode.ts'
import { useStopIndex } from '../lib/queries.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { useVehicles } from '../lib/vehicles.ts'

export default function StopMap({
  stopId,
  name,
  live,
  departures,
}: {
  stopId: string
  name: string
  /** False while the board is offline, stale or failed: no positions. */
  live: boolean
  departures: Departure[]
}) {
  const { mode, fetcher } = useApi()
  const { byKey } = useStopIndex(fetcher, mode, true)
  const vehicles = useVehicles(fetcher, mode, null)
  const nowMs = useNow(Date.now(), 5_000)
  const state = liveState(vehicles.data, { offline: !useOnline(), nowMs, ...usePageCheck() })
  // And no failed request since (React Query keeps the last answer after a failure, retries included).
  const fresh =
    live && vehicles.data != null && state == null && !vehicles.isError && vehicles.failureCount === 0
  const stop = byKey.get(stopId)
  const markers = useMemo(() => {
    const byTrip = new Map(departures.map((d) => [d.tripInstance, d]))
    const out: MapMarker[] = []
    for (const v of fresh ? (vehicles.data?.vehicles ?? []) : []) {
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
  }, [fresh, vehicles.data, departures, stop, stopId, name])
  const busCount = markers.length - (stop ? 1 : 0)
  // Still waiting for the first answer (nothing failed yet): no count until it's in.
  const waiting = live && !vehicles.data && !vehicles.isError
  return (
    <div data-place-map="" className="flex flex-col gap-1.5">
      <SafeMap
        markers={markers}
        fitTo={stop ? [`stop:${stopId}`] : undefined}
        label={fresh ? `Map of ${name} with ${busCount} live buses heading here` : `Map of ${name}`}
        className="h-72 w-full overflow-hidden rounded-card bg-map-ground md:h-96"
        zoom={15}
        center={stop ? [stop.lon, stop.lat] : undefined}
      />
      <p className="text-xs text-sched-text" role="status">
        {fresh
          ? `${busCount === 1 ? '1 live bus' : `${busCount} live buses`} on the way · positions refresh every 15 s`
          : waiting
            ? 'Finding live buses…'
            : 'Live bus positions are unavailable right now.'}
      </p>
    </div>
  )
}
