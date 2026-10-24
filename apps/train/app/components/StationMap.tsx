/**
 * The station's small map in the board's idle panel at 1024 px and wider, with no "Going to" (THE-118 PR 7): the
 * station and the live trains on its departures, as square pins. Lazy, with MapLibre behind SafeMap (no WebGL2: the
 * "Map unavailable" panel). Positions only while the board's data and the trains' own answer are live.
 */
import type { Departure } from '@bft/core/contract'
import { liveState, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import type { Station } from '../lib/network.ts'
import { type DataMode, useFetcher, useVehicles } from '../lib/queries.ts'
import { useOnline } from '../lib/useNow.ts'

export default function StationMap({
  station,
  departures,
  mode,
  nowMs,
}: {
  station: Station
  departures: Departure[]
  mode: DataMode
  nowMs: number
}) {
  const q = useVehicles(useFetcher(mode), mode, true)
  const state = liveState(q.data, { offline: !useOnline(), nowMs, ...usePageCheck() })
  const live = q.data != null && state == null
  const trains = useMemo(() => {
    const trips = new Set(departures.map((d) => d.tripInstance))
    return (live ? (q.data?.vehicles ?? []) : []).filter((v) => v.tripKey && trips.has(v.tripKey))
  }, [q.data, departures, live])
  const markers: MapMarker[] = useMemo(
    () => [
      {
        id: `station:${station.key}`,
        lat: station.lat,
        lon: station.lon,
        shape: 'square' as const,
        tone: 'selected' as const,
        label: `${station.name} station`,
      },
      ...trains.map((v) => ({
        id: v.id,
        lat: v.lat,
        lon: v.lon,
        shape: 'square' as const,
        tone: 'allstops' as const,
        pulse: true,
        label: `Train ${v.label ?? v.id}`,
      })),
    ],
    [station, trains],
  )
  return (
    <section aria-label={`Map of ${station.name}`} data-place-map="" className="flex flex-col gap-1.5">
      <SafeMap
        markers={markers}
        fitTo={[`station:${station.key}`]}
        label={
          live
            ? `Map of ${station.name} station with ${trains.length} live trains on its departures`
            : `Map of ${station.name} station`
        }
        className="h-80 w-full overflow-hidden rounded-card bg-map-ground xl:h-96"
        zoom={14}
        center={[station.lon, station.lat]}
      />
      <p className="text-xs text-sched-text dark:text-night-text/70" role="status">
        {live ? (
          <>
            {trains.length === 1 ? '1 live train' : `${trains.length} live trains`} on {station.name}'s
            departures · positions refresh every 15 s
          </>
        ) : !q.data && !q.isError ? (
          'Finding live trains…'
        ) : (
          'Live train positions are unavailable right now.'
        )}
      </p>
    </section>
  )
}
