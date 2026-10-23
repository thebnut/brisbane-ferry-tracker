/**
 * The terminal's small map in the board's idle panel at 1024 px and wider, with no "To" (THE-118 PR 7): the terminal
 * and the live ferries on its departures. Lazy, with MapLibre behind SafeMap (no WebGL2: the "Map unavailable" panel).
 * Positions only while the board is live.
 */
import type { Departure } from '@bft/core/contract'
import { vesselName } from '@bft/ui'
import type { MapMarker } from '@bft/ui/map'
import { useWide } from '@bft/ui/panel'
import SafeMap from '@bft/ui/safe-map'
import { useMemo } from 'react'
import type { ApiFetcher } from '../lib/api.ts'
import { cleanStopName } from '../lib/names.ts'
import type { DataMode } from '../lib/queries.ts'
import { type StopChoice, terminalById } from '../lib/terminals.ts'
import { useVehicles } from '../lib/vehicles.ts'

interface Props {
  terminal: StopChoice
  /** False while the board is offline or stale: no positions. */
  live: boolean
  departures: Departure[]
  fetcher: ApiFetcher
  mode: DataMode
}

/** Only at 1024 px and wider, where the panel shows (a phone fetches no positions for a hidden map). */
export default function WideTerminalMap(props: Props) {
  return useWide() ? <TerminalMap {...props} /> : null
}

function TerminalMap({ terminal, live, departures, fetcher, mode }: Props) {
  const vehicles = useVehicles(fetcher, mode, true)
  const t = terminalById(terminal.id)
  const name = cleanStopName(terminal.name)
  const ferries = useMemo(() => {
    const byTrip = new Map(departures.map((d) => [d.tripInstance, d]))
    const positions = live && vehicles.data?.rtState === 'live' ? vehicles.data.vehicles : []
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
  }, [vehicles.data, departures, live])
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
        label={`Map of ${name} terminal with ${ferries.length} live ferries on its departures`}
        className="h-80 w-full overflow-hidden rounded-card bg-map-ground xl:h-96"
        zoom={14}
        center={t ? [t.lng, t.lat] : undefined}
      />
      <p className="text-xs text-sched-text dark:text-night-text/70">
        {ferries.length === 1 ? '1 live ferry' : `${ferries.length} live ferries`} on {name}'s departures ·
        positions refresh every 15 s
      </p>
    </section>
  )
}
