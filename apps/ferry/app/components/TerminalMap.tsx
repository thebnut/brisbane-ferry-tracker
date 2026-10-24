/**
 * The terminal's small map in the board's idle panel at 1024 px and wider, with no "To" (THE-118 PR 7): the terminal
 * and the live ferries on its departures. Lazy, with MapLibre behind SafeMap (no WebGL2: the "Map unavailable" panel).
 * Positions only while the board is live.
 */
import type { Departure } from '@bft/core/contract'
import { vesselName } from '@bft/ui'
import { isWide, notWide, onWide } from '@bft/ui/board-route'
import { liveState, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo, useSyncExternalStore } from 'react'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useFetcher } from '../lib/queries.ts'
import { type StopChoice, terminalById } from '../lib/terminals.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { useVehicles } from '../lib/vehicles.ts'

interface Props {
  terminal: StopChoice
  /** False while the board is offline or stale: no positions. */
  live: boolean
  departures: Departure[]
  mode: DataMode
}

/** Only at 1024 px and wider, where the panel shows (a phone fetches no positions for a hidden map). */
export default function WideTerminalMap(props: Props) {
  return useSyncExternalStore(onWide, isWide, notWide) ? <TerminalMap {...props} /> : null
}

function TerminalMap({ terminal, live, departures, mode }: Props) {
  const vehicles = useVehicles(useFetcher(mode), mode, true)
  // The positions' own answer must be live and fresh too, not only the board's (an old copy never pulses as live).
  const nowMs = useNow(Date.now(), 5_000)
  const fresh = liveState(vehicles.data, { offline: !useOnline(), nowMs, ...usePageCheck() }) == null
  // And no failed request since (React Query keeps the last answer after a failure, retries included).
  const shown =
    live && fresh && vehicles.data?.rtState === 'live' && !vehicles.isError && vehicles.failureCount === 0
  const t = terminalById(terminal.id)
  const name = cleanStopName(terminal.name)
  const ferries = useMemo(() => {
    const byTrip = new Map(departures.map((d) => [d.tripInstance, d]))
    const positions = shown ? (vehicles.data?.vehicles ?? []) : []
    return positions.flatMap((v) => {
      const d = v.tripKey ? byTrip.get(v.tripKey) : undefined
      if (!d) return []
      const express = d.route.short === 'F11'
      return [
        {
          id: v.id,
          lat: v.lat,
          lon: v.lon,
          pulse: true,
          tone: express ? ('express' as const) : ('allstops' as const),
          label: `${vesselName(v.id) ?? 'Ferry'}${express ? ' (express)' : ''}`,
        },
      ]
    })
  }, [vehicles.data, departures, shown])
  const markers: MapMarker[] = useMemo(
    () => [
      ...(t
        ? [{ id: t.id, lat: t.lat, lon: t.lng, tone: 'selected' as const, label: `${t.name} terminal` }]
        : []),
      ...ferries,
    ],
    [t, ferries],
  )
  return (
    <section aria-label={`Map of ${name}`} data-place-map="" className="flex flex-col gap-1.5">
      <SafeMap
        markers={markers}
        fitTo={t ? [t.id] : undefined}
        label={
          shown
            ? `Map of ${name} terminal with ${ferries.length} live ferries on its departures`
            : `Map of ${name} terminal`
        }
        className="h-80 w-full overflow-hidden rounded-card bg-map-ground xl:h-96"
        zoom={14}
        center={t ? [t.lng, t.lat] : undefined}
      />
      <p className="text-xs text-sched-text dark:text-night-text/70" role="status">
        {shown ? (
          <>
            {ferries.length === 1 ? '1 live ferry' : `${ferries.length} live ferries`} on {name}'s departures
            · positions refresh every 15 s
          </>
        ) : live && !vehicles.data && !vehicles.isError ? (
          'Finding live ferries…'
        ) : (
          'Live ferry positions are unavailable right now.'
        )}
      </p>
    </section>
  )
}
