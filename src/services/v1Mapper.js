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

const toDate = (epochS) => (epochS == null ? null : new Date(epochS * 1000));

/**
 * One direction of the board. `originId` is the selected legacy boarding stop id
 * and `direction` is 'outbound' or 'inbound' (the request already filtered by `to`).
 *
 * Status mapping (badges in DepartureItem):
 *  - live      -> isRealtime (LIVE badge), scheduledTime/delay from schedDep vs estDep
 *  - scheduled -> isScheduled (Scheduled badge)
 *  - unknown   -> isScheduled: a cancellation seen while RT is stale; legacy shows these as scheduled
 *  - cancelled, skipped -> dropped: the legacy board has no UI for them
 * The GPS badge comes from the vehicle positions list, as before.
 */
export function mapDepartures(response, { originId, direction, vehiclesByTripId = new Map(), now = new Date() }) {
  const nowMs = now.getTime();
  const cutoffMs = nowMs + 24 * 60 * 60 * 1000;
  const out = [];

  for (const dep of response.departures) {
    if (dep.status === 'cancelled' || dep.status === 'skipped') continue;

    const isLive = dep.status === 'live' && dep.estDep != null;
    const departureTime = toDate(isLive ? dep.estDep : dep.schedDep);
    // Same window as ferryData.processTripUpdates: from now to 24 hours ahead.
    if (departureTime.getTime() < nowMs || departureTime.getTime() > cutoffMs) continue;

    const tripId = tripIdFromKey(dep.tripInstance);
    const vehicle = vehiclesByTripId.get(tripId)?.vehicle;
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

/** VehiclesResponse -> GTFS-RT FeedEntity-like objects for FerryMap / FerryDetailsModal. */
export function mapVehicles(response) {
  return response.vehicles.map((v) => {
    const tripId = tripIdFromKey(v.tripKey);
    return {
      id: v.id,
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

export function indexVehiclesByTripId(entities) {
  const map = new Map();
  for (const e of entities) {
    const tripId = e.vehicle?.trip?.tripId;
    if (tripId && !map.has(tripId)) map.set(tripId, e);
  }
  return map;
}
