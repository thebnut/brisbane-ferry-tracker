// Fetches the selected pair's departures (both directions) and ferry vehicle
// positions from the transit API's /v1 endpoints and maps them onto the legacy
// shapes. Throws on any failure or unusable rtState so useFerryData can fall
// back to the legacy path for that refresh.
import ferryDataService from './ferryData';
import { getTransitApiBase } from '../utils/dataSource';
import { isUsableResponse, mapDepartures, mapVehicles, indexVehiclesByTripId } from './v1Mapper';

// groupByDirection keeps 13 per direction; ask for a few more to cover rows
// the mapper drops (cancelled, skipped, already departed).
const DEPARTURE_LIMIT = 20;
const TIMEOUT_MS = 8000;

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${getTransitApiBase()}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`/v1 HTTP ${response.status} for ${path}`);
    const body = await response.json();
    if (!isUsableResponse(body)) throw new Error(`/v1 unusable response (rtState=${body?.rtState}) for ${path}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const departuresPath = (fromId, toId) =>
  `/v1/ferry/stops/${encodeURIComponent(fromId)}/departures?to=${encodeURIComponent(toId)}&limit=${DEPARTURE_LIMIT}`;

export async function getV1FerryData(selectedStops, departureTimeFilter) {
  const originId = selectedStops.outbound.id;
  const destId = selectedStops.inbound.id;

  const [outboundRes, inboundRes, vehiclesRes] = await Promise.all([
    fetchJson(departuresPath(originId, destId)),
    fetchJson(departuresPath(destId, originId)),
    fetchJson('/v1/ferry/vehicles'),
  ]);

  const vehiclePositions = mapVehicles(vehiclesRes);
  const vehiclesByTripId = indexVehiclesByTripId(vehiclePositions);
  const now = new Date();
  const all = [
    ...mapDepartures(outboundRes, { originId, direction: 'outbound', vehiclesByTripId, now }),
    ...mapDepartures(inboundRes, { originId: destId, direction: 'inbound', vehiclesByTripId, now }),
  ];

  // An empty board is more likely a /v1 gap than a genuinely empty river:
  // let the legacy path (48 h of schedule) decide.
  if (all.length === 0) throw new Error('/v1 returned no departures for either direction');

  ferryDataService.setSelectedStops(selectedStops);
  ferryDataService.setDepartureTimeFilter(departureTimeFilter);
  return {
    departures: ferryDataService.groupByDirection(all),
    vehiclePositions,
  };
}
