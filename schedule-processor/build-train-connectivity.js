/**
 * Build Train Station Connectivity Map
 *
 * Analyzes GTFS data to determine which stations are directly reachable
 * from each station (no transfers required).
 *
 * Output: src/data/trainStationConnectivity.json
 * Format: { "STATION_SLUG": ["DEST_SLUG_1", "DEST_SLUG_2", ...] }
 *
 * Usage: node build-train-connectivity.js
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const ROUTE_TYPE_TRAIN = 2; // GTFS route type for trains

/**
 * Parse CSV content
 */
function parseCSV(content) {
  const result = Papa.parse(content, { header: true, skipEmptyLines: true });
  return result.data;
}

/**
 * Convert station name to slug (matching train.config.js)
 */
function toStationSlug(stationName) {
  return stationName
    .replace(/\s+station$/i, '') // Remove " station" suffix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/^_|_$/g, ''); // Trim leading/trailing underscores
}

/**
 * Download and parse GTFS data
 */
async function downloadGTFS() {
  console.log('📥 Downloading GTFS data...');
  const response = await fetch(GTFS_URL);
  const buffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  console.log('✅ GTFS data downloaded');

  console.log('📄 Parsing GTFS files...');
  const files = {
    stops: parseCSV(await zip.file('stops.txt').async('string')),
    routes: parseCSV(await zip.file('routes.txt').async('string')),
    trips: parseCSV(await zip.file('trips.txt').async('string')),
    stop_times: parseCSV(await zip.file('stop_times.txt').async('string'))
  };

  console.log(`  ✓ stops.txt: ${files.stops.length} records`);
  console.log(`  ✓ routes.txt: ${files.routes.length} records`);
  console.log(`  ✓ trips.txt: ${files.trips.length} records`);
  console.log(`  ✓ stop_times.txt: ${files.stop_times.length} records`);

  return files;
}

/**
 * Build platform to station mapping
 */
async function buildPlatformMapping() {
  console.log('🔗 Loading station-platform mappings...');

  const groupedData = JSON.parse(
    await fs.readFile(path.join(__dirname, 'train-stations-grouped.json'), 'utf-8')
  );

  const platformToStation = new Map(); // platform ID -> station slug

  groupedData.stations.forEach(station => {
    const stationSlug = toStationSlug(station.name);

    station.stopIds.forEach(platformId => {
      platformToStation.set(platformId, stationSlug);
    });
  });

  console.log(`✅ Mapped ${platformToStation.size} platforms to ${groupedData.stations.length} stations`);
  return platformToStation;
}

/**
 * Build connectivity map from GTFS data
 */
async function buildConnectivity() {
  const gtfs = await downloadGTFS();
  const platformToStation = await buildPlatformMapping();

  console.log('🚂 Filtering train data...');

  // Get train route IDs
  const trainRouteIds = new Set(
    gtfs.routes
      .filter(r => parseInt(r.route_type) === ROUTE_TYPE_TRAIN)
      .map(r => r.route_id)
  );

  // Get train trip IDs
  const trainTripIds = new Set(
    gtfs.trips
      .filter(t => trainRouteIds.has(t.route_id))
      .map(t => t.trip_id)
  );

  // Get train stop times
  const trainStopTimes = gtfs.stop_times
    .filter(st => trainTripIds.has(st.trip_id))
    .sort((a, b) => {
      // Sort by trip_id, then stop_sequence
      if (a.trip_id < b.trip_id) return -1;
      if (a.trip_id > b.trip_id) return 1;
      return parseInt(a.stop_sequence) - parseInt(b.stop_sequence);
    });

  console.log(`✅ Found ${trainRouteIds.size} train routes, ${trainTripIds.size} trips, ${trainStopTimes.length} stop_times`);

  console.log('🔗 Building station connectivity map...');

  // Group stop_times by trip
  const tripStopSequences = new Map(); // trip_id -> array of station slugs

  trainStopTimes.forEach(st => {
    const stationSlug = platformToStation.get(st.stop_id);

    if (!stationSlug) {
      // Platform not in our station mapping (might be a different mode or obsolete)
      return;
    }

    if (!tripStopSequences.has(st.trip_id)) {
      tripStopSequences.set(st.trip_id, []);
    }

    const sequence = tripStopSequences.get(st.trip_id);

    // Only add if it's a different station (skip duplicate platforms in same station)
    if (sequence.length === 0 || sequence[sequence.length - 1] !== stationSlug) {
      sequence.push(stationSlug);
    }
  });

  console.log(`✅ Built ${tripStopSequences.size} trip station sequences`);

  // Build connectivity map
  const connectivity = new Map(); // station -> Set of reachable stations

  tripStopSequences.forEach((stationSequence, tripId) => {
    // For each station in the sequence
    stationSequence.forEach((originStation, originIndex) => {
      if (!connectivity.has(originStation)) {
        connectivity.set(originStation, new Set());
      }

      // Add all subsequent stations as reachable
      for (let i = originIndex + 1; i < stationSequence.length; i++) {
        const destStation = stationSequence[i];
        connectivity.get(originStation).add(destStation);
      }
    });
  });

  console.log(`✅ Found connectivity for ${connectivity.size} stations`);

  // Convert Sets to sorted Arrays
  const connectivityObj = {};
  Array.from(connectivity.entries())
    .sort((a, b) => a[0].localeCompare(b[0])) // Sort stations alphabetically
    .forEach(([station, destinations]) => {
      connectivityObj[station] = Array.from(destinations).sort();
    });

  return connectivityObj;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🚆 Building Train Station Connectivity Map\n');

    const connectivity = await buildConnectivity();

    // Write output file
    const outputPath = path.join(__dirname, '../src/data/trainStationConnectivity.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      JSON.stringify(connectivity, null, 2),
      'utf-8'
    );

    console.log(`\n✅ Connectivity map written to: ${outputPath}`);

    // Print statistics
    const totalStations = Object.keys(connectivity).length;
    const totalConnections = Object.values(connectivity).reduce((sum, dests) => sum + dests.length, 0);
    const avgConnections = (totalConnections / totalStations).toFixed(1);

    console.log(`\n📊 Statistics:`);
    console.log(`  - Total stations: ${totalStations}`);
    console.log(`  - Total connections: ${totalConnections}`);
    console.log(`  - Average destinations per station: ${avgConnections}`);

    // Show sample
    console.log(`\n📋 Sample connectivity:`);
    const sampleStations = ['MORNINGSIDE', 'ROMA_STREET', 'CENTRAL'];
    sampleStations.forEach(station => {
      if (connectivity[station]) {
        console.log(`  ${station}: ${connectivity[station].length} destinations`);
        console.log(`    → ${connectivity[station].slice(0, 5).join(', ')}${connectivity[station].length > 5 ? ', ...' : ''}`);
      }
    });

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
