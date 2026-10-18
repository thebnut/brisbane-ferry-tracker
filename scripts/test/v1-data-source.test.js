// Tests for the /v1 data-source flag and mapper. Run with `npm test`
// (plain node:test, so the legacy app needs no test framework).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_SOURCE_SESSION_KEY,
  ROLLOUT_ID_KEY,
  bucketOf,
  parsePercent,
  resolveDataSource,
  resolveTransitApiBase,
} from '../../src/utils/dataSource.js';
import {
  indexVehicles,
  isUsableResponse,
  mapDepartures,
  mapVehicles,
  tripIdFromKey,
} from '../../src/services/v1Mapper.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
    this.writes = 0;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.writes++;
    this.map.set(key, String(value));
  }
}

const throwingStorage = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('denied');
  },
};

// --- flag resolution -------------------------------------------------------

test('defaults to legacy and writes nothing to storage', () => {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  assert.equal(resolveDataSource({ search: '', env: {}, session, local }), 'legacy');
  assert.equal(session.writes, 0);
  assert.equal(local.writes, 0);
});

test('?dataSource=v1 turns it on and sticks for the session', () => {
  const session = new MemoryStorage();
  assert.equal(resolveDataSource({ search: '?dataSource=v1', session }), 'v1');
  assert.equal(session.getItem(DATA_SOURCE_SESSION_KEY), 'v1');
  assert.equal(resolveDataSource({ search: '', session }), 'v1');
});

test('?dataSource=legacy overrides a build-time v1 and sticks', () => {
  const session = new MemoryStorage();
  const env = { VITE_FERRY_DATA_SOURCE: 'v1' };
  assert.equal(resolveDataSource({ search: '?dataSource=legacy', env, session }), 'legacy');
  assert.equal(resolveDataSource({ search: '', env, session }), 'legacy');
});

test('unknown param values are ignored', () => {
  assert.equal(resolveDataSource({ search: '?dataSource=yes' }), 'legacy');
});

test('VITE_FERRY_DATA_SOURCE=v1 at build time', () => {
  assert.equal(resolveDataSource({ env: { VITE_FERRY_DATA_SOURCE: 'v1' } }), 'v1');
  assert.equal(resolveDataSource({ env: { VITE_FERRY_DATA_SOURCE: 'legacy' } }), 'legacy');
});

test('percentage rollout buckets by a stable random id', () => {
  const local = new MemoryStorage();
  const first = resolveDataSource({ env: { VITE_FERRY_V1_PERCENT: '50' }, local });
  const id = local.getItem(ROLLOUT_ID_KEY);
  assert.ok(id);
  assert.equal(resolveDataSource({ env: { VITE_FERRY_V1_PERCENT: '50' }, local }), first);
  assert.equal(local.getItem(ROLLOUT_ID_KEY), id);
  assert.equal(first, bucketOf(id) < 50 ? 'v1' : 'legacy');
});

test('rollout 0% and 100%', () => {
  const local = new MemoryStorage({ [ROLLOUT_ID_KEY]: 'abc' });
  assert.equal(resolveDataSource({ env: { VITE_FERRY_V1_PERCENT: '0' }, local }), 'legacy');
  assert.equal(resolveDataSource({ env: { VITE_FERRY_V1_PERCENT: '100' }, local }), 'v1');
});

test('rollout spreads roughly evenly', () => {
  let inTen = 0;
  for (let i = 0; i < 10000; i++) if (bucketOf(`id-${i}-${i * 7919}`) < 10) inTen++;
  assert.ok(inTen > 800 && inTen < 1200, `10% bucket got ${inTen}/10000`);
});

test('parsePercent clamps garbage', () => {
  assert.equal(parsePercent(undefined), 0);
  assert.equal(parsePercent(''), 0);
  assert.equal(parsePercent('abc'), 0);
  assert.equal(parsePercent('-5'), 0);
  assert.equal(parsePercent('10'), 10);
  assert.equal(parsePercent('250'), 100);
});

test('storage that throws never breaks resolution', () => {
  const env = { VITE_FERRY_V1_PERCENT: '100' };
  assert.equal(resolveDataSource({ search: '?dataSource=v1', session: throwingStorage }), 'v1');
  assert.equal(resolveDataSource({ env, session: throwingStorage, local: throwingStorage }), 'v1');
  assert.equal(resolveDataSource({ session: throwingStorage, local: throwingStorage }), 'legacy');
});

test('API base default and override', () => {
  assert.equal(resolveTransitApiBase({}), 'https://bft-api.brisbanetransit.workers.dev');
  assert.equal(resolveTransitApiBase({ VITE_TRANSIT_API_BASE: 'http://localhost:8787/' }), 'http://localhost:8787');
});

// --- mapper ----------------------------------------------------------------

const NOW = new Date('2026-10-18T03:00:00Z'); // 13:00 AEST
const nowS = NOW.getTime() / 1000;
const BULIMBA = '317584';
const RIVERSIDE = '317590';

const envelope = (extra) => ({
  schemaVersion: 1,
  staticGeneration: 'g1',
  serviceDates: ['20261018'],
  rtSourceTimestamp: nowS - 20,
  rtState: 'live',
  generatedAt: NOW.getTime(),
  mode: 'ferry',
  stop: { key: BULIMBA, name: 'Bulimba', stopIds: [BULIMBA] },
  to: { key: RIVERSIDE, name: 'Riverside' },
  ...extra,
});

const dep = (over) => ({
  tripInstance: 'T1@20261018',
  stopSequence: 5,
  route: { id: 'F11-4055', short: 'F11' },
  headsign: 'Riverside',
  directionId: 0,
  stopId: BULIMBA,
  platform: null,
  schedDep: nowS + 600,
  estDep: null,
  schedArrTo: nowS + 1500,
  estArrTo: null,
  status: 'scheduled',
  gps: false,
  vehicleId: null,
  ...over,
});

test('tripIdFromKey strips the service date and the ADDED prefix', () => {
  assert.equal(tripIdFromKey('34567-F1@20261018'), '34567-F1');
  assert.equal(tripIdFromKey('rt:UNPLANNED-1@20261018'), 'UNPLANNED-1');
  assert.equal(tripIdFromKey('weird@id@20261018'), 'weird@id');
  assert.equal(tripIdFromKey(undefined), undefined);
});

test('scheduled row -> legacy scheduled departure', () => {
  const [row] = mapDepartures(envelope({ departures: [dep()] }), { originId: BULIMBA, direction: 'outbound', now: NOW });
  assert.deepEqual(row, {
    tripId: 'T1',
    routeId: 'F11-4055',
    departureTime: new Date((nowS + 600) * 1000),
    stopId: BULIMBA,
    direction: 'outbound',
    isRealtime: false,
    isScheduled: true,
    delay: 0,
    vehicleId: undefined,
    occupancy: undefined,
    destinationArrivalTime: new Date((nowS + 1500) * 1000),
    scheduledArrivalTime: new Date((nowS + 1500) * 1000),
  });
  assert.equal('scheduledTime' in row, false);
});

test('live row -> LIVE with delay, scheduledTime and estimated arrival', () => {
  const vehicles = mapVehicles(
    envelope({
      vehicles: [{ id: 'V_MOOROOLBIN II', tripKey: 'T1@20261018', routeId: 'F11-4055', lat: -27.4, lon: 153.0, occupancy: 'MANY_SEATS_AVAILABLE', ts: nowS }],
    }),
  );
  const [row] = mapDepartures(
    envelope({
      departures: [dep({ status: 'live', estDep: nowS + 780, estArrTo: nowS + 1680, gps: true, vehicleId: 'V_MOOROOLBIN II' })],
    }),
    { originId: BULIMBA, direction: 'outbound', vehicles: indexVehicles(vehicles), now: NOW },
  );
  assert.equal(row.isRealtime, true);
  assert.equal(row.isScheduled, false);
  assert.equal(row.delay, 180);
  assert.deepEqual(row.departureTime, new Date((nowS + 780) * 1000));
  assert.deepEqual(row.scheduledTime, new Date((nowS + 600) * 1000));
  assert.deepEqual(row.destinationArrivalTime, new Date((nowS + 1680) * 1000));
  assert.deepEqual(row.scheduledArrivalTime, new Date((nowS + 1500) * 1000));
  assert.equal(row.vehicleId, 'V_MOOROOLBIN II');
  assert.equal(row.occupancy, 'MANY_SEATS_AVAILABLE');
});

test('live with an early estimate gives a negative delay (no "late" label)', () => {
  const [row] = mapDepartures(envelope({ departures: [dep({ status: 'live', estDep: nowS + 540 })] }), {
    originId: BULIMBA,
    direction: 'outbound',
    now: NOW,
  });
  assert.equal(row.delay, -60);
});

test('live row whose destination has no estimate falls back to the scheduled arrival', () => {
  const [row] = mapDepartures(envelope({ departures: [dep({ status: 'live', estDep: nowS + 600 })] }), {
    originId: BULIMBA,
    direction: 'outbound',
    now: NOW,
  });
  assert.deepEqual(row.destinationArrivalTime, new Date((nowS + 1500) * 1000));
});

test('cancelled, skipped and unknown rows are hidden', () => {
  const rows = mapDepartures(
    envelope({
      departures: [
        dep({ tripInstance: 'C@20261018', status: 'cancelled' }),
        dep({ tripInstance: 'S@20261018', status: 'skipped' }),
        dep({ tripInstance: 'U@20261018', status: 'unknown' }),
        dep({ tripInstance: 'OK@20261018', status: 'scheduled' }),
      ],
    }),
    { originId: BULIMBA, direction: 'outbound', now: NOW },
  );
  assert.deepEqual(
    rows.map((r) => r.tripId),
    ['OK'],
  );
});

test("a vehicle on today's run doesn't attach to tomorrow's run of the same trip id", () => {
  const vehicles = indexVehicles(
    mapVehicles(envelope({ vehicles: [{ id: 'V1', tripKey: 'T1@20261018', routeId: 'F1', lat: 0, lon: 0, ts: nowS }] })),
  );
  const rows = mapDepartures(
    envelope({
      departures: [
        dep({ tripInstance: 'T1@20261018', schedDep: nowS + 60 }),
        dep({ tripInstance: 'T1@20261019', schedDep: nowS + 20 * 3600 }),
        dep({ tripInstance: 'T2@20261018', schedDep: nowS + 120 }),
      ],
    }),
    { originId: BULIMBA, direction: 'outbound', vehicles, now: NOW },
  );
  assert.deepEqual(
    rows.map((r) => [r.tripId, r.vehicleId]),
    [
      ['T1', 'V1'],
      ['T1@20261019', undefined],
      ['T2', undefined],
    ],
  );
});

test('ADDED trips join their vehicle through the rt: prefix', () => {
  const vehicles = indexVehicles(
    mapVehicles(envelope({ vehicles: [{ id: 'V9', tripKey: 'rt:X1@20261018', routeId: 'F1', lat: 0, lon: 0, ts: nowS }] })),
  );
  const [row] = mapDepartures(envelope({ departures: [dep({ tripInstance: 'rt:X1@20261018' })] }), {
    originId: BULIMBA,
    direction: 'outbound',
    vehicles,
    now: NOW,
  });
  assert.equal(row.tripId, 'X1');
  assert.equal(row.vehicleId, 'V9');
});

test('departed and beyond-24h rows are dropped, like the legacy realtime path', () => {
  const rows = mapDepartures(
    envelope({
      departures: [
        dep({ tripInstance: 'PAST@20261018', schedDep: nowS - 60 }),
        dep({ tripInstance: 'LATE@20261018', schedDep: nowS - 120, status: 'live', estDep: nowS + 60 }),
        dep({ tripInstance: 'FAR@20261019', schedDep: nowS + 25 * 3600 }),
      ],
    }),
    { originId: BULIMBA, direction: 'outbound', now: NOW },
  );
  assert.deepEqual(
    rows.map((r) => r.tripId),
    ['LATE'],
  );
});

test('the board stop id is the selected stop, whatever the API reports', () => {
  const [row] = mapDepartures(envelope({ departures: [dep({ stopId: '317584a' })] }), {
    originId: BULIMBA,
    direction: 'outbound',
    now: NOW,
  });
  assert.equal(row.stopId, BULIMBA);
});

test('vehicles map onto GTFS-RT entity shape used by FerryMap and the modal', () => {
  const [withTrip, noTrip] = mapVehicles(
    envelope({
      vehicles: [
        { id: 'V1', label: 'Kuluwin', tripKey: 'T9@20261018', routeId: 'F1-4055', lat: -27.47, lon: 153.03, bearing: 90, speed: 5, status: 'IN_TRANSIT_TO', stopId: RIVERSIDE, ts: nowS },
        { id: 'V2', lat: -27.4, lon: 153.0, ts: nowS },
      ],
    }),
  );
  assert.deepEqual(withTrip, {
    id: 'V1',
    v1TripInstance: 'T9@20261018',
    v1Stops: { currentStop: null, nextStop: RIVERSIDE },
    vehicle: {
      trip: { tripId: 'T9', routeId: 'F1-4055' },
      vehicle: { id: 'V1', label: 'Kuluwin' },
      position: { latitude: -27.47, longitude: 153.03, bearing: 90, speed: 5 },
      currentStatus: 'IN_TRANSIT_TO',
      occupancyStatus: undefined,
      stopId: RIVERSIDE,
      timestamp: nowS,
    },
  });
  assert.equal(noTrip.vehicle.trip, undefined);
  assert.equal(indexVehicles([withTrip, noTrip]).byInstance.size, 1);
});

test('STOPPED_AT puts the vehicle stop in currentStop (string or numeric enum)', () => {
  const [a, b] = mapVehicles(
    envelope({
      vehicles: [
        { id: 'A', tripKey: 'T@20261018', lat: 0, lon: 0, status: 'STOPPED_AT', stopId: BULIMBA, ts: nowS },
        { id: 'B', tripKey: 'U@20261018', lat: 0, lon: 0, status: 1, stopId: BULIMBA, ts: nowS },
      ],
    }),
  );
  assert.deepEqual(a.v1Stops, { currentStop: BULIMBA, nextStop: null });
  assert.deepEqual(b.v1Stops, { currentStop: BULIMBA, nextStop: null });
});

test('stale vehicle positions are not shown as live GPS', () => {
  const stale = envelope({ rtState: 'stale', vehicles: [{ id: 'V1', tripKey: 'T1@20261018', lat: 0, lon: 0, ts: nowS }] });
  assert.deepEqual(mapVehicles(stale), []);
});

test('only live and stale responses are usable', () => {
  assert.equal(isUsableResponse(envelope({ departures: [] })), true);
  assert.equal(isUsableResponse(envelope({ rtState: 'stale', vehicles: [] })), true);
  assert.equal(isUsableResponse(envelope({ rtState: 'reloading', departures: [] })), false);
  assert.equal(isUsableResponse(envelope({ rtState: 'unavailable', departures: [] })), false);
  assert.equal(isUsableResponse(envelope({ rtState: 'live' })), false);
  assert.equal(isUsableResponse({ error: 'not_found' }), false);
  assert.equal(isUsableResponse(null), false);
});
