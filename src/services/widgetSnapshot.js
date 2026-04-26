// BRI-29: Build a compact snapshot of the next few departures for the iOS
// Home Screen widget. Written to App Group UserDefaults by the WidgetBridge
// plugin; read by the WidgetKit extension's TimelineProvider.
//
// Contract (key: `widget.snapshot.v1`):
// {
//   v: 1,
//   updatedAt: ISO-8601 string,
//   outbound: { originName, destName, departures: [ MinimalDeparture, ... ] }
// }
//
// MinimalDeparture = {
//   tripId:     string or omitted (GTFS trip id, used by widget for stable row id)
//   t:          ISO-8601 string (departure time, realtime when available)
//   scheduledT: ISO-8601 string or omitted (scheduled departure time if different)
//   arrivalT:   ISO-8601 string or omitted (destination arrival time)
//   route:      "F1" | "F11" | ... (raw route id, widget maps to label)
//   live:       true | omitted (shown as a "LIVE" badge; omitted === false)
//   delaySec:   number or omitted (only set if non-zero)
// }
//
// Schema versioning: bump `v` only on BREAKING changes (renamed/removed
// required fields, date-format swaps, route-id semantics changes). Additive
// optional fields are safe — Swift's Codable ignores unknown keys, and
// optional new fields decode as nil when absent on older writers.
//
// Widget maps `route` strings itself (no i18n drift), so all unused fields
// from the source (`vehicleId`, `occupancy`, `stopId`, `direction`) are
// deliberately stripped. v1 only serialises the outbound direction; the
// widget doesn't render inbound in v1, so don't pay the bytes to ship it.
// Snapshot stays well under 1 KB for 3 departures.

const MAX_PER_DIRECTION = 3;
// Include departures for a short grace period after their scheduled time
// (ferries often slip a minute or two, and the widget's countdown copes
// with "Now"). Stricter cutoffs here just empty the widget unhelpfully.
const PAST_GRACE_MS = 60_000;

function toISO(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  // Depending on the path through ferryData.js, some times arrive as numbers
  // (epoch ms) or strings. Be permissive — reject only clearly-broken values.
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function minimaliseDeparture(departure, now) {
  const t = toISO(departure?.departureTime);
  if (!t) return null;

  const departureMs = new Date(t).getTime();
  if (departureMs < now.getTime() - PAST_GRACE_MS) return null;

  const minimal = { t };

  // Stable identity for the widget's ForEach: tripId survives delay changes
  // (when `t` shifts by delaySec between snapshots) so rows don't re-create
  // and the LIVE badge doesn't re-animate on every snapshot refresh.
  if (departure.tripId) minimal.tripId = String(departure.tripId);

  // GTFS-RT route IDs often carry a vehicle-ID suffix like "F1-4055".
  // Widget only needs the canonical base route id (F1, F11) for its
  // Express/All-stops label mapping — strip anything after the first hyphen.
  const rawRoute = departure.routeId || '';
  const route = rawRoute.split('-')[0];
  if (route) minimal.route = route;

  if (departure.isRealtime) minimal.live = true;

  const delaySec = Number(departure.delay);
  if (Number.isFinite(delaySec) && delaySec !== 0) {
    minimal.delaySec = Math.round(delaySec);
  }

  const scheduledT = toISO(departure.scheduledTime);
  if (scheduledT && scheduledT !== t) minimal.scheduledT = scheduledT;

  const arrivalT = toISO(departure.destinationArrivalTime);
  if (arrivalT) minimal.arrivalT = arrivalT;

  return minimal;
}

function pickNext(departures, now) {
  if (!Array.isArray(departures)) return [];
  const picked = [];
  for (const dep of departures) {
    const m = minimaliseDeparture(dep, now);
    if (m) picked.push(m);
    if (picked.length >= MAX_PER_DIRECTION) break;
  }
  return picked;
}

/**
 * Build the widget snapshot JSON for the iOS Home Screen widget.
 *
 * Pure function — no side effects, no clock reads. Caller supplies `now` so
 * tests (and the widget's fixed `entry.date` timeline) stay deterministic.
 *
 * Only the outbound direction is serialised — the widget doesn't render
 * inbound in v1. When a direction toggle lands (BRI-45-ish), add inbound
 * back as an additive optional field; no schema bump needed.
 *
 * @param {{outbound: Array}} departures - Output of ferryDataService.mergeWithScheduledData()
 * @param {{outbound: {id: string, name: string}, inbound: {id: string, name: string}}} selectedStops
 * @param {Date} now - Reference time; entries earlier than now - 60s are dropped.
 * @returns {object} Snapshot object ready for JSON.stringify.
 */
export function buildSnapshot(departures, selectedStops, now = new Date()) {
  return {
    v: 1,
    updatedAt: now.toISOString(),
    outbound: {
      originName: selectedStops?.outbound?.name || '',
      destName: selectedStops?.inbound?.name || '',
      departures: pickNext(departures?.outbound, now),
    },
  };
}
