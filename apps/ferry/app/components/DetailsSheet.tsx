/**
 * Departure details (legacy FerryDetailsModal) as a bottom sheet: departure and arrival with schedule/delay and
 * journey time, vessel and status, the stopping pattern from /v1 trips, and a live position map when GPS is known.
 */
import type { Departure } from '@bft/core/contract'
import {
  BottomSheet,
  dayMarker,
  delayText,
  formatClock,
  formatDuration,
  StatusBadge,
  StoppingPattern,
  vesselName,
} from '@bft/ui'
import { lazy, Suspense } from 'react'
import type { ApiFetcher } from '../lib/api.ts'
import { effectiveDep, isExpress, serviceLabel } from '../lib/departures.ts'
import { cleanStopName } from '../lib/names.ts'
import { type DataMode, useTrip } from '../lib/queries.ts'
import { terminalById } from '../lib/terminals.ts'

const MapView = lazy(() => import('@bft/ui/map'))

const VEHICLE_STATUS: Record<string, string> = {
  INCOMING_AT: 'Approaching stop',
  STOPPED_AT: 'Stopped at terminal',
  IN_TRANSIT_TO: 'In transit',
}

export interface DetailsSheetProps {
  departure: Departure | null
  fromName: string
  toName: string
  toId: string
  nowMs: number
  fetcher: ApiFetcher
  mode: DataMode
  onClose: () => void
}

export function DetailsSheet({ departure, fromName, toName, toId, nowMs, fetcher, mode, onClose }: DetailsSheetProps) {
  const trip = useTrip(fetcher, mode, departure?.tripInstance ?? null)
  if (!departure) return null
  const d = departure
  const dep = effectiveDep(d)
  const arr = d.estArrTo ?? d.schedArrTo
  const vehicle = trip.data?.vehicle ?? null
  const vessel = vesselName(vehicle?.id ?? d.vehicleId)
  const status = vehicle?.status ? VEHICLE_STATUS[vehicle.status] : null
  const late = delayText(d.schedDep, d.estDep)

  // Stopping pattern from this terminal to the destination (and on to the end of the trip).
  const tripStops = trip.data?.stops ?? []
  const from = tripStops.findIndex((s) => s.stopSequence === d.stopSequence)
  const pattern =
    from >= 0
      ? tripStops.slice(from).map((s) => ({
          id: `${s.stopId}:${s.stopSequence}`,
          name: cleanStopName(s.name ?? terminalById(s.stopId)?.name ?? s.stopId),
          stops: s.status !== 'skipped' && (s.pickup !== 1 || s.dropOff !== 1),
        }))
      : []
  const destIdx = from >= 0 ? tripStops.slice(from).findIndex((s) => s.stopId === toId) : -1
  const visiblePattern = destIdx >= 0 ? pattern.slice(0, destIdx + 1) : pattern

  const fromT = terminalById(d.stopId)
  const toT = terminalById(toId)
  const markers = [
    ...(vehicle
      ? [
          {
            id: 'vehicle',
            lat: vehicle.lat,
            lon: vehicle.lon,
            pulse: true,
            tone: isExpress(d) ? ('express' as const) : ('allstops' as const),
            label: `${vessel ?? 'Ferry'} live position`,
          },
        ]
      : []),
    ...[fromT, toT]
      .filter((t) => t != null)
      .map((t) => ({ id: t.id, lat: t.lat, lon: t.lng, tone: 'stop' as const, label: `${t.name} terminal` })),
  ]

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`${isExpress(d) ? 'Express' : 'All-stops'} ferry · ${d.route.short}`}
      subtitle={
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {d.status === 'live' ? <StatusBadge kind="live" /> : null}
            {d.gps || vehicle ? <StatusBadge kind="gps" /> : null}
            {d.status === 'scheduled' ? <StatusBadge kind="scheduled" /> : null}
            {d.status === 'cancelled' ? <StatusBadge kind="cancelled" /> : null}
            <span className="text-[11px] font-extrabold tracking-wide text-ferry-orange-deep">{serviceLabel(d)}</span>
          </div>
          <p className="text-sm text-gray-700">
            {cleanStopName(fromName)} → {cleanStopName(toName)}
          </p>
          <p className="text-xs text-sched-text">
            Vehicle: {vessel ?? 'Unknown'}
            {status ? ` | ${status}` : ''}
          </p>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-card bg-ferry-light-blue/60 p-4">
          <p className="text-sm text-gray-700">Departure from {cleanStopName(fromName)}</p>
          <p className="text-2xl font-extrabold tabular">
            {formatClock(dep)}
            {dayMarker(dep, nowMs) ? (
              <span className="ml-2 text-lg font-medium text-ferry-orange-dark">{dayMarker(dep, nowMs)}</span>
            ) : null}
          </p>
          {d.status === 'live' && d.estDep != null ? (
            <p className="mt-1 text-sm text-sched-text">Scheduled: {formatClock(d.schedDep)}</p>
          ) : null}
          {late ? <p className="mt-1 text-sm font-medium text-cancel-text">{late}</p> : null}
        </div>
        <div className="rounded-card bg-ferry-light-blue/60 p-4">
          <p className="text-sm text-gray-700">Arrival at {cleanStopName(toName)}</p>
          {arr != null ? (
            <>
              <p className="text-2xl font-extrabold tabular">
                {formatClock(arr)}
                {dayMarker(arr, nowMs) ? (
                  <span className="ml-2 text-lg font-medium text-ferry-orange-dark">{dayMarker(arr, nowMs)}</span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-sched-text">Journey time: {formatDuration((arr - dep) / 60)}</p>
            </>
          ) : (
            <p className="text-lg text-sched-text">Arrival time not available</p>
          )}
        </div>
      </div>

      <h3 className="mt-5 mb-2 text-base font-semibold text-aqua-text">Stopping pattern</h3>
      {trip.isPending ? (
        <p className="text-sm text-sched-text">Loading stops…</p>
      ) : visiblePattern.length > 0 ? (
        <StoppingPattern stops={visiblePattern} color={d.route.color} />
      ) : (
        <p className="text-sm text-sched-text">Stop list not available.</p>
      )}

      {vehicle ? (
        <>
          <h3 className="mt-5 mb-2 text-base font-semibold text-aqua-text">Live position</h3>
          <Suspense fallback={<div className="h-72 rounded-card bg-map-ground" />}>
            <MapView
              markers={markers}
              label={`Map showing ${vessel ?? 'the ferry'} between ${fromName} and ${toName}`}
              className="h-72 w-full overflow-hidden rounded-card bg-map-ground"
            />
          </Suspense>
        </>
      ) : null}
    </BottomSheet>
  )
}
