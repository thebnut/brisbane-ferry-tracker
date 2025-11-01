/**
 * Train Schedule API Processor
 *
 * Generates per-route JSON files for API consumption
 * Uploads to Vercel Blob Storage (NOT git repository)
 *
 * Phase 2: API Infrastructure
 * Completely separate from ferry production processor
 *
 * Usage: node process-schedule-api.js
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { put } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const MODE = 'train';
const ROUTE_TYPE = 2; // GTFS route type for trains
const TIMEZONE = 'Australia/Brisbane';
const GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const DAYS_TO_PROCESS = 7; // Process next week of schedules

/**
 * Build platform-to-station mapping from grouped stations file
 * @returns {Promise<{platformToStation: Map, stationSlugs: Map, stationPlatforms: Map}>}
 */
async function buildStationMappings() {
  try {
    const groupedData = JSON.parse(
      await fs.readFile(path.join(__dirname, 'train-stations-grouped.json'), 'utf-8')
    );

    const platformToStation = new Map(); // platform ID -> station name
    const stationSlugs = new Map(); // station name -> URL-safe slug
    const stationPlatforms = new Map(); // station name -> array of platform IDs

    groupedData.stations.forEach(station => {
      const stationName = station.name;

      // Create URL-safe slug (e.g., "Bowen Hills station" -> "BOWEN_HILLS")
      const slug = stationName
        .replace(/\s+station$/i, '') // Remove " station" suffix
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_') // Replace non-alphanumeric with underscore
        .replace(/^_|_$/g, ''); // Trim leading/trailing underscores

      stationSlugs.set(stationName, slug);
      stationPlatforms.set(stationName, station.stopIds);

      // Map each platform ID to this station
      station.stopIds.forEach(platformId => {
        platformToStation.set(platformId, stationName);
      });
    });

    console.log(`✅ Built mappings for ${stationSlugs.size} stations, ${platformToStation.size} platforms`);

    return { platformToStation, stationSlugs, stationPlatforms };
  } catch (error) {
    console.error('❌ Failed to build station mappings:', error.message);
    throw error;
  }
}

// Parse CSV content
function parseCSV(content) {
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false // Keep all as strings initially
  });
  return result.data;
}

/**
 * Download GTFS data from TransLink
 */
async function downloadGTFS() {
  console.log('📥 Downloading GTFS data from TransLink...');

  try {
    const response = await fetch(GTFS_URL);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    console.log(`✅ Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

    return buffer;
  } catch (error) {
    console.error('❌ Failed to download GTFS:', error);
    throw error;
  }
}

/**
 * Extract and parse GTFS files
 */
async function parseGTFSFiles(gtfsBuffer) {
  console.log('📦 Extracting GTFS files...');

  const zip = await JSZip.loadAsync(gtfsBuffer);
  const files = {};

  // Required files
  const requiredFiles = [
    'stops.txt',
    'routes.txt',
    'trips.txt',
    'stop_times.txt',
    'calendar.txt',
    'calendar_dates.txt'
  ];

  for (const filename of requiredFiles) {
    const file = zip.file(filename);

    if (!file) {
      console.warn(`⚠️  ${filename} not found in GTFS`);
      files[filename] = [];
      continue;
    }

    const content = await file.async('text');
    files[filename] = parseCSV(content);
    console.log(`  ✓ ${filename}: ${files[filename].length} records`);
  }

  return files;
}

/**
 * Filter for train routes and stops
 */
function filterTrainData(gtfsData) {
  console.log('🚂 Filtering train data...');

  // Filter routes by type
  const trainRoutes = gtfsData['routes.txt'].filter(
    route => route.route_type === String(ROUTE_TYPE)
  );

  const routeIds = new Set(trainRoutes.map(r => r.route_id));
  console.log(`  Found ${routeIds.size} train routes`);

  // Filter trips for train routes
  const trainTrips = gtfsData['trips.txt'].filter(
    trip => routeIds.has(trip.route_id)
  );

  const tripIds = new Set(trainTrips.map(t => t.trip_id));
  console.log(`  Found ${tripIds.size} train trips`);

  // Filter stop times for train trips
  const trainStopTimes = gtfsData['stop_times.txt'].filter(
    st => tripIds.has(st.trip_id)
  );

  console.log(`  Found ${trainStopTimes.length} train stop times`);

  // Get unique train stops
  const stopIds = new Set(trainStopTimes.map(st => st.stop_id));
  const trainStops = gtfsData['stops.txt'].filter(
    stop => stopIds.has(stop.stop_id)
  );

  console.log(`  Found ${trainStops.length} train stops`);

  return {
    routes: trainRoutes,
    trips: trainTrips,
    stopTimes: trainStopTimes,
    stops: trainStops,
    calendar: gtfsData['calendar.txt'],
    calendarDates: gtfsData['calendar_dates.txt']
  };
}

/**
 * Get active service IDs for date range
 */
function getActiveServices(calendar, calendarDates, startDate, endDate) {
  const servicesByDate = new Map();

  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayOfWeek = format(currentDate, 'EEEE').toLowerCase();
    const dateStr = format(currentDate, 'yyyyMMdd');
    const activeServices = new Set();

    // Check regular calendar
    calendar.forEach(service => {
      const serviceStart = parse(service.start_date, 'yyyyMMdd', new Date());
      const serviceEnd = parse(service.end_date, 'yyyyMMdd', new Date());

      if (currentDate >= serviceStart && currentDate <= serviceEnd && service[dayOfWeek] === '1') {
        activeServices.add(service.service_id);
      }
    });

    // Apply calendar date exceptions
    calendarDates.forEach(exception => {
      if (exception.date === dateStr) {
        if (exception.exception_type === '1') {
          activeServices.add(exception.service_id);
        } else if (exception.exception_type === '2') {
          activeServices.delete(exception.service_id);
        }
      }
    });

    servicesByDate.set(dateStr, Array.from(activeServices));
    currentDate = addDays(currentDate, 1);
  }

  return servicesByDate;
}

/**
 * Generate route pair files (STATION-LEVEL aggregation)
 * Aggregates all platform combinations into station-to-station routes
 */
async function generateRoutePairs(trainData) {
  console.log('🔄 Generating station-to-station route pairs...');

  const startDate = startOfDay(new Date());
  const endDate = addDays(startDate, DAYS_TO_PROCESS);

  // Build station mappings
  const { platformToStation, stationSlugs, stationPlatforms } = await buildStationMappings();

  // Get active services
  const servicesByDate = getActiveServices(
    trainData.calendar,
    trainData.calendarDates,
    startDate,
    endDate
  );

  // Build stop sequence for each trip
  const tripStopSequences = new Map();

  trainData.stopTimes.forEach(st => {
    if (!tripStopSequences.has(st.trip_id)) {
      tripStopSequences.set(st.trip_id, []);
    }

    tripStopSequences.get(st.trip_id).push({
      stopId: st.stop_id,
      sequence: parseInt(st.stop_sequence || '0'),
      arrival: st.arrival_time,
      departure: st.departure_time
    });
  });

  // Sort each trip's stops by sequence
  for (const [tripId, stops] of tripStopSequences) {
    stops.sort((a, b) => a.sequence - b.sequence);
  }

  // Create map of stops for quick lookup
  const stopsMap = new Map(
    trainData.stops.map(stop => [stop.stop_id, stop])
  );

  // Create map of routes for quick lookup
  const routesMap = new Map(
    trainData.routes.map(route => [route.route_id, route])
  );

  // Generate STATION-LEVEL route pairs
  const routePairs = new Map();
  let tripsProcessed = 0;
  let platformPairsAggregated = 0;

  for (const trip of trainData.trips) {
    const stops = tripStopSequences.get(trip.trip_id);

    if (!stops || stops.length < 2) {
      continue;
    }

    const route = routesMap.get(trip.route_id);

    // For each pair of stops in this trip
    for (let i = 0; i < stops.length - 1; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const originPlatformId = stops[i].stopId;
        const destPlatformId = stops[j].stopId;

        // Map platforms to stations
        const originStation = platformToStation.get(originPlatformId);
        const destStation = platformToStation.get(destPlatformId);

        if (!originStation || !destStation) {
          // Skip if platform not in our mapping (shouldn't happen)
          continue;
        }

        // Create STATION-LEVEL pair key using slugs
        const originSlug = stationSlugs.get(originStation);
        const destSlug = stationSlugs.get(destStation);
        const stationPairKey = `${originSlug}-${destSlug}`;

        platformPairsAggregated++;

        // Initialize station pair if first time seeing it
        if (!routePairs.has(stationPairKey)) {
          const originStop = stopsMap.get(originPlatformId);
          const destStop = stopsMap.get(destPlatformId);

          routePairs.set(stationPairKey, {
            origin: {
              station: originStation,
              slug: originSlug,
              allPlatforms: stationPlatforms.get(originStation),
              // Representative coordinates (from first encountered platform)
              lat: parseFloat(originStop?.stop_lat || '0'),
              lng: parseFloat(originStop?.stop_lon || '0')
            },
            destination: {
              station: destStation,
              slug: destSlug,
              allPlatforms: stationPlatforms.get(destStation),
              // Representative coordinates (from first encountered platform)
              lat: parseFloat(destStop?.stop_lat || '0'),
              lng: parseFloat(destStop?.stop_lon || '0')
            },
            departures: []
          });
        }

        // Add this departure with platform information preserved
        const originStop = stopsMap.get(originPlatformId);
        const destStop = stopsMap.get(destPlatformId);

        routePairs.get(stationPairKey).departures.push({
          tripId: trip.trip_id,
          routeId: trip.route_id,
          routeName: route?.route_short_name || route?.route_long_name || 'Unknown',
          headsign: trip.trip_headsign || '',
          scheduledDeparture: stops[i].departure,
          scheduledArrival: stops[j].arrival,
          serviceId: trip.service_id,
          // Backward compatible platform field (UI expects this)
          platform: originStop?.platform_code || null,
          // Extended platform info for future features
          platformDetails: {
            origin: {
              id: originPlatformId,
              number: originStop?.platform_code || null,
              name: originStop?.stop_name || 'Unknown'
            },
            destination: {
              id: destPlatformId,
              number: destStop?.platform_code || null,
              name: destStop?.stop_name || 'Unknown'
            }
          }
        });
      }
    }

    tripsProcessed++;
    if (tripsProcessed % 100 === 0) {
      console.log(`  Processed ${tripsProcessed}/${trainData.trips.length} trips...`);
    }
  }

  console.log(`✅ Generated ${routePairs.size} unique STATION pairs (aggregated from ${platformPairsAggregated} platform pairs)`);
  console.log(`   Reduction: ${Math.round((1 - routePairs.size / platformPairsAggregated) * 100)}% fewer files`);

  return routePairs;
}

/**
 * Upload route pairs to Vercel Blob Storage
 */
async function uploadToBlob(routePairs) {
  console.log('☁️  Uploading to Vercel Blob Storage...');

  let uploaded = 0;
  let skipped = 0;

  for (const [pairKey, data] of routePairs) {
    // Skip routes with no departures
    if (data.departures.length === 0) {
      skipped++;
      continue;
    }

    const filename = `train-${pairKey}.json`;
    const content = JSON.stringify(data);

    try {
      await put(filename, content, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false // Use exact filename for consistent API queries
      });

      uploaded++;

      if (uploaded % 100 === 0) {
        console.log(`  Uploaded ${uploaded}/${routePairs.size} routes...`);
      }
    } catch (error) {
      console.error(`  ❌ Failed to upload ${filename}:`, error.message);
    }
  }

  console.log(`✅ Uploaded ${uploaded} route files`);
  console.log(`⚠️  Skipped ${skipped} empty routes`);

  return { uploaded, skipped };
}

/**
 * Identify popular routes (most departures)
 */
function identifyPopularRoutes(routePairs) {
  console.log('📊 Identifying popular routes...');

  const sorted = Array.from(routePairs.entries())
    .map(([key, data]) => ({
      key,
      origin: data.origin,
      destination: data.destination,
      departureCount: data.departures.length
    }))
    .sort((a, b) => b.departureCount - a.departureCount)
    .slice(0, 20);

  console.log('\n🔥 Top 20 Popular Station Routes:');
  sorted.forEach((route, i) => {
    console.log(
      `  ${i + 1}. ${route.origin.station} → ${route.destination.station}: ${route.departureCount} departures`
    );
  });

  return sorted;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Train Schedule API Processor');
  console.log('================================\n');

  try {
    // Step 1: Download GTFS
    const gtfsBuffer = await downloadGTFS();

    // Step 2: Parse GTFS files
    const gtfsData = await parseGTFSFiles(gtfsBuffer);

    // Step 3: Filter train data
    const trainData = filterTrainData(gtfsData);

    // Step 4: Generate route pairs
    const routePairs = await generateRoutePairs(trainData);

    // Step 5: Identify popular routes
    const popularRoutes = identifyPopularRoutes(routePairs);

    // Step 6: Upload to Blob Storage
    const { uploaded, skipped } = await uploadToBlob(routePairs);

    // Step 7: Generate metadata
    const metadata = {
      generated: new Date().toISOString(),
      mode: MODE,
      totalRoutePairs: routePairs.size,
      uploaded,
      skipped,
      popularRoutes: popularRoutes.map(r => r.key),
      stops: trainData.stops.length,
      routes: trainData.routes.length,
      trips: trainData.trips.length
    };

    // Upload metadata
    await put('train-metadata.json', JSON.stringify(metadata, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });

    console.log('\n✅ Process complete!');
    console.log(`   Total routes: ${routePairs.size}`);
    console.log(`   Uploaded: ${uploaded}`);
    console.log(`   Skipped: ${skipped}`);

  } catch (error) {
    console.error('\n❌ Process failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateRoutePairs, uploadToBlob, identifyPopularRoutes };
