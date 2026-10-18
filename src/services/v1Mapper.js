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
    // The UI joins vehicles to departures on trip.tripId. Use the matched
    // vehicle's join id; with no match, keep the full instance key if a vehicle
    // runs the same trip id on another service date, so this row can't pick up
    // that vessel's GPS.
    const tripId = vehicle
      ? vehicle.trip.tripId
      : vehicles.bareTripIds.has(bareTripId) ? instance : bareTripId;
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

// gtfsService decodes GTFS-RT enums as numbers and the components compare
// against those (FerryMap: `currentStatus === 1`), so /v1's enum names are
// normalised to the same numbers. Unknown values pass through unchanged.
const VEHICLE_STOP_STATUS = { INCOMING_AT: 0, STOPPED_AT: 1, IN_TRANSIT_TO: 2 };
const OCCUPANCY_STATUS = {
  EMPTY: 0,
  MANY_SEATS_AVAILABLE: 1,
  FEW_SEATS_AVAILABLE: 2,
  STANDING_ROOM_ONLY: 3,
  CRUSHED_STANDING_ROOM_ONLY: 4,
  FULL: 5,
  NOT_ACCEPTING_PASSENGERS: 6,
};
const toEnum = (table, value) => {
  if (value == null) return value;
  if (Object.hasOwn(table, value)) return table[value];
  const n = Number(value);
  return Number.isInteger(n) && String(value).trim() !== '' ? n : value;
};

/**
 * VehiclesResponse -> GTFS-RT FeedEntity-like objects for FerryMap / FerryDetailsModal.
 * A stale response yields no vehicles: stale positions must not show as live GPS
 * (the core merger also sets `gps: false` when RT is stale).
 *
 * `trip.tripId` is the bare GTFS trip id (what the UI joins and shows), except
 * when vehicles run the same trip id on two service dates: then both use their
 * full instance key so the UI can't attach the wrong vessel.
 *
 * `v1Stops` carries the stop context FerryMap normally derives from TripUpdates,
 * which /v1 doesn't send. Only these entities have it, so the legacy path is unaffected.
 * GTFS-RT stop_id is the stop the vehicle is AT when STOPPED_AT, otherwise the next stop.
 */
export function mapVehicles(response) {
  if (response.rtState !== 'live') return [];

  const instancesByTripId = new Map();
  for (const v of response.vehicles) {
    const tripId = tripIdFromKey(v.tripKey);
    if (!tripId) continue;
    if (!instancesByTripId.has(tripId)) instancesByTripId.set(tripId, new Set());
    instancesByTripId.get(tripId).add(instanceOf(v.tripKey));
  }

  return response.vehicles.map((v) => {
    const bareTripId = tripIdFromKey(v.tripKey);
    const instance = instanceOf(v.tripKey);
    const tripId = bareTripId && instancesByTripId.get(bareTripId).size > 1 ? instance : bareTripId;
    const status = toEnum(VEHICLE_STOP_STATUS, v.status);
    const stoppedAt = status === VEHICLE_STOP_STATUS.STOPPED_AT;
    return {
      id: v.id,
      v1TripInstance: instance,
      v1Stops: {
        currentStop: v.stopId && stoppedAt ? v.stopId : null,
        nextStop: v.stopId && !stoppedAt ? v.stopId : null,
      },
      vehicle: {
        trip: tripId ? { tripId, routeId: v.routeId } : undefined,
        vehicle: { id: v.id, label: v.label },
        position: { latitude: v.lat, longitude: v.lon, bearing: v.bearing, speed: v.speed },
        currentStatus: status,
        occupancyStatus: toEnum(OCCUPANCY_STATUS, v.occupancy),
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
    const tripId = tripIdFromKey(e.v1TripInstance);
    if (tripId) bareTripIds.add(tripId);
  }
  return { byInstance, bareTripIds };
}
