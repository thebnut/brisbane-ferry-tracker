// Maps transit API /v1 responses (packages/core/src/contract/index.ts) onto the
// shapes the legacy components already render:
//  - DeparturesResponse rows -> the departure objects ferryData.js builds
//  - VehiclesResponse vehicles -> GTFS-RT VehiclePosition entities (as decoded by gtfsService)
//
// No imports, so scripts/test can run it under plain Node.

// rtState values for which /v1 data is trusted. 'reloading' and 'unavailable'
// (or anything unknown) make the caller fall back to the legacy path.
export const USABLE_RT_STATES = new Set(['live', 'stale']);

export const isUsableResponse = (response) =>
  !!response && Array.isArray(response.departures ?? response.vehicles) && USABLE_RT_STATES.has(response.rtState);

// `{tripId}@{serviceDate}`; ADDED trips use `rt:{tripId}@{date}`. Legacy code
// keys everything on the bare GTFS trip_id.
export function tripIdFromKey(key) {
  if (!key) return undefined;
  const at = key.lastIndexOf('@');
  const head = at === -1 ? key : key.slice(0, at);
  return head.startsWith('rt:') ? head.slice(3) : head;
}

// The trip instance with any ADDED-trip prefix removed, for joins.
const instanceOf = (key) => (key?.startsWith('rt:') ? key.slice(3) : key);

const toDate = (epochS) => (epochS == null ? null : new Date(epochS * 1000));

/**
 * One direction of the board. `originId` is the selected legacy boarding stop id
 * and `direction` is 'outbound' or 'inbound' (the request already filtered by `to`).
 * `vehicles` is the result of indexVehicles().
 *
 * Status mapping (badges in DepartureItem):
 *  - live      -> isRealtime (LIVE badge), scheduledTime/delay from schedDep vs estDep
 *  - scheduled -> isScheduled (Scheduled badge)
 *  - cancelled, skipped, unknown -> dropped: the legacy board has no UI for them, and
 *    `unknown` (a cancellation seen while RT is stale) must not be advertised as scheduled
 * The GPS badge comes from the vehicle positions list, as before.
 */
export function mapDepartures(response, { originId, direction, vehicles = indexVehicles([]), now = new Date() }) {
  const nowMs = now.getTime();
  const cutoffMs = nowMs + 24 * 60 * 60 * 1000;
  const out = [];

  for (const dep of response.departures) {
    if (dep.status !== 'live' && dep.status !== 'scheduled') continue;

    const isLive = dep.status === 'live' && dep.estDep != null;
    const departureTime = toDate(isLive ? dep.estDep : dep.schedDep);
    // Same window as ferryData.processTripUpdates: from now to 24 hours ahead.
    if (departureTime.getTime() < nowMs || departureTime.getTime() > cutoffMs) continue;

    const instance = instanceOf(dep.tripInstance);
    const vehicle = vehicles.byInstance.get(instance)?.vehicle;
    const bareTripId = tripIdFromKey(dep.tripInstance);
    // The UI joins vehicles to departures on the bare trip id. If a vehicle runs
    // the same trip id on another service date (today's run vs tomorrow's), keep
    // the full instance key so this row can't pick up that vessel's GPS.
    const tripId = !vehicle && vehicles.bareTripIds.has(bareTripId) ? instance : bareTripId;
    const arrivalS = isLive ? (dep.estArrTo ?? dep.schedArrTo) : dep.schedArrTo;

    const row = {
      tripId,
      routeId: dep.route?.id || dep.route?.short,
      departureTime,
      // The board groups by the selected stop id; the request was made for it.
      stopId: originId,
      direction,
      isRealtime: isLive,
      isScheduled: !isLive,
      delay: isLive ? dep.estDep - dep.schedDep : 0,
      vehicleId: dep.vehicleId ?? vehicle?.vehicle?.id,
      occupancy: vehicle?.occupancyStatus,
      destinationArrivalTime: toDate(arrivalS),
      scheduledArrivalTime: toDate(dep.schedArrTo),
    };
    if (isLive) row.scheduledTime = toDate(dep.schedDep);
    out.push(row);
  }

  return out;
}

// GTFS-RT VehicleStopStatus: stop_id is the stop the vehicle is AT when
// STOPPED_AT, otherwise the stop it is heading to.
const isStoppedAt = (status) => status === 'STOPPED_AT' || status === 1 || status === '1';

/**
 * VehiclesResponse -> GTFS-RT FeedEntity-like objects for FerryMap / FerryDetailsModal.
 * A stale response yields no vehicles: stale positions must not show as live GPS
 * (the core merger also sets `gps: false` when RT is stale).
 *
 * `v1Stops` carries the stop context FerryMap normally derives from TripUpdates,
 * which /v1 doesn't send. Only these entities have it, so the legacy path is unaffected.
 */
export function mapVehicles(response) {
  if (response.rtState !== 'live') return [];
  return response.vehicles.map((v) => {
    const tripId = tripIdFromKey(v.tripKey);
    const stoppedAt = isStoppedAt(v.status);
    return {
      id: v.id,
      v1TripInstance: instanceOf(v.tripKey),
      v1Stops: {
        currentStop: v.stopId && stoppedAt ? v.stopId : null,
        nextStop: v.stopId && !stoppedAt ? v.stopId : null,
      },
      vehicle: {
        trip: tripId ? { tripId, routeId: v.routeId } : undefined,
        vehicle: { id: v.id, label: v.label },
        position: { latitude: v.lat, longitude: v.lon, bearing: v.bearing, speed: v.speed },
        currentStatus: v.status,
        occupancyStatus: v.occupancy,
        stopId: v.stopId,
        timestamp: v.ts,
      },
    };
  });
}

export function indexVehicles(entities) {
  const byInstance = new Map();
  const bareTripIds = new Set();
  for (const e of entities) {
    if (e.v1TripInstance && !byInstance.has(e.v1TripInstance)) byInstance.set(e.v1TripInstance, e);
    const tripId = e.vehicle?.trip?.tripId;
    if (tripId) bareTripIds.add(tripId);
  }
  return { byInstance, bareTripIds };
}
