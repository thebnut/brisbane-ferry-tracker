/**
 * Extract Train Stations from GTFS
 *
 * Creates a JSON file with all train stations for use in the UI
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import fs from 'fs/promises';

const GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const ROUTE_TYPE = 2; // GTFS route type for trains

// Parse CSV content
function parseCSV(content) {
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false
  });
  return result.data;
}

/**
 * Download GTFS data
 */
async function downloadGTFS() {
  console.log('📥 Downloading GTFS data...');

  const response = await fetch(GTFS_URL);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  console.log(`✅ Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

  return buffer;
}

/**
 * Extract train stations from GTFS
 */
async function extractTrainStations() {
  console.log('\n🚆 Extracting Train Stations from GTFS\n');

  // Download and extract GTFS
  const gtfsBuffer = await downloadGTFS();
  const zip = await JSZip.loadAsync(gtfsBuffer);

  // Parse stops and routes
  console.log('📦 Parsing GTFS files...');
  const stopsContent = await zip.file('stops.txt').async('text');
  const routesContent = await zip.file('routes.txt').async('text');
  const tripsContent = await zip.file('trips.txt').async('text');

  const stops = parseCSV(stopsContent);
  const routes = parseCSV(routesContent);
  const trips = parseCSV(tripsContent);

  console.log(`  ✓ Found ${stops.length} total stops`);
  console.log(`  ✓ Found ${routes.length} routes`);
  console.log(`  ✓ Found ${trips.length} trips`);

  // Filter train routes
  const trainRoutes = routes.filter(route => route.route_type === '2');
  const trainRouteIds = new Set(trainRoutes.map(r => r.route_id));

  console.log(`  ✓ Found ${trainRoutes.length} train routes`);

  // Get train trips
  const trainTrips = trips.filter(trip => trainRouteIds.has(trip.route_id));
  const trainStopIds = new Set();

  // We need to parse stop_times to get actual train stops
  console.log('📍 Identifying train stations from stop_times...');
  const stopTimesContent = await zip.file('stop_times.txt').async('text');
  const stopTimes = parseCSV(stopTimesContent);

  const trainTripIds = new Set(trainTrips.map(t => t.trip_id));

  stopTimes.forEach(st => {
    if (trainTripIds.has(st.trip_id)) {
      trainStopIds.add(st.stop_id);
    }
  });

  console.log(`  ✓ Found ${trainStopIds.size} train station IDs`);

  // Filter train stations
  const trainStations = stops
    .filter(stop => trainStopIds.has(stop.stop_id))
    .map(stop => ({
      id: stop.stop_id,
      name: stop.stop_name,
      lat: parseFloat(stop.stop_lat),
      lon: parseFloat(stop.stop_lon),
      code: stop.stop_code || null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n✅ Extracted ${trainStations.length} train stations\n`);

  // Display sample stations
  console.log('Sample stations:');
  trainStations.slice(0, 10).forEach(station => {
    console.log(`  - ${station.name} (${station.id})`);
  });

  // Save to file
  const outputPath = './train-stations.json';
  await fs.writeFile(
    outputPath,
    JSON.stringify({
      generated: new Date().toISOString(),
      totalStations: trainStations.length,
      stations: trainStations
    }, null, 2)
  );

  console.log(`\n💾 Saved to ${outputPath}`);

  // Also create a simplified version for UI
  const uiStations = trainStations.map(s => ({
    id: s.id,
    name: s.name.replace(' station', '').trim() // Cleaner names for UI
  }));

  const uiOutputPath = './train-stations-ui.json';
  await fs.writeFile(
    uiOutputPath,
    JSON.stringify(uiStations, null, 2)
  );

  console.log(`💾 Saved UI version to ${uiOutputPath}`);

  console.log('\n🎉 Done!\n');
}

// Run
extractTrainStations().catch(console.error);
