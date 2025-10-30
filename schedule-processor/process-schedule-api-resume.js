/**
 * Train Schedule API Processor - RESUME VERSION
 *
 * Skips already uploaded files for faster resumption
 *
 * Usage: node process-schedule-api-resume.js
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { put, list, head } from '@vercel/blob';
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
 * Generate route pairs
 */
async function generateRoutePairs(trainData) {
  console.log('🔄 Generating route pairs...');

  const startDate = startOfDay(new Date());
  const endDate = addDays(startDate, DAYS_TO_PROCESS);

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

  // Generate route pairs
  const routePairs = new Map();
  let tripsProcessed = 0;

  for (const trip of trainData.trips) {
    const stops = tripStopSequences.get(trip.trip_id);

    if (!stops || stops.length < 2) {
      continue;
    }

    const route = routesMap.get(trip.route_id);

    // For each pair of stops in this trip
    for (let i = 0; i < stops.length - 1; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const originId = stops[i].stopId;
        const destId = stops[j].stopId;
        const pairKey = `${originId}-${destId}`;

        if (!routePairs.has(pairKey)) {
          const originStop = stopsMap.get(originId);
          const destStop = stopsMap.get(destId);

          routePairs.set(pairKey, {
            origin: {
              id: originId,
              name: originStop?.stop_name || 'Unknown',
              lat: parseFloat(originStop?.stop_lat || '0'),
              lng: parseFloat(originStop?.stop_lon || '0'),
              platform: originStop?.platform_code || null
            },
            destination: {
              id: destId,
              name: destStop?.stop_name || 'Unknown',
              lat: parseFloat(destStop?.stop_lat || '0'),
              lng: parseFloat(destStop?.stop_lon || '0'),
              platform: destStop?.platform_code || null
            },
            departures: []
          });
        }

        // Add this departure
        routePairs.get(pairKey).departures.push({
          tripId: trip.trip_id,
          routeId: trip.route_id,
          routeName: route?.route_short_name || route?.route_long_name || 'Unknown',
          headsign: trip.trip_headsign || '',
          scheduledDeparture: stops[i].departure,
          scheduledArrival: stops[j].arrival,
          serviceId: trip.service_id,
          platform: stopsMap.get(originId)?.platform_code || null
        });
      }
    }

    tripsProcessed++;
    if (tripsProcessed % 100 === 0) {
      console.log(`  Processed ${tripsProcessed}/${trainData.trips.length} trips...`);
    }
  }

  console.log(`✅ Generated ${routePairs.size} unique route pairs`);
  return routePairs;
}

/**
 * Get existing files from Blob Storage
 */
async function getExistingFiles() {
  console.log('🔍 Checking existing files in Blob Storage...');

  const existingFiles = new Set();
  let cursor;
  let totalChecked = 0;

  try {
    do {
      const result = await list({ cursor });

      for (const blob of result.blobs) {
        if (blob.pathname.startsWith('train-') && blob.pathname.endsWith('.json')) {
          existingFiles.add(blob.pathname);
        }
      }

      totalChecked += result.blobs.length;
      cursor = result.hasMore ? result.cursor : undefined;

      if (totalChecked % 500 === 0) {
        console.log(`  Checked ${totalChecked} files...`);
      }
    } while (cursor);

    console.log(`✅ Found ${existingFiles.size} existing train route files`);
    return existingFiles;
  } catch (error) {
    console.warn('⚠️  Could not check existing files:', error.message);
    console.log('   Will upload all files...');
    return new Set();
  }
}

/**
 * Upload route pairs to Vercel Blob Storage (skip existing)
 */
async function uploadToBlob(routePairs, existingFiles) {
  console.log('☁️  Uploading to Vercel Blob Storage...');

  let uploaded = 0;
  let skipped = 0;
  let alreadyExists = 0;

  for (const [pairKey, data] of routePairs) {
    // Skip routes with no departures
    if (data.departures.length === 0) {
      skipped++;
      continue;
    }

    const filename = `train-${pairKey}.json`;

    // Skip if already uploaded
    if (existingFiles.has(filename)) {
      alreadyExists++;
      if (alreadyExists % 100 === 0) {
        console.log(`  Skipped ${alreadyExists} existing files...`);
      }
      continue;
    }

    const content = JSON.stringify(data);

    try {
      await put(filename, content, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false // Use exact filename for consistent API queries
      });

      uploaded++;

      if (uploaded % 100 === 0) {
        console.log(`  Uploaded ${uploaded} new routes...`);
      }
    } catch (error) {
      console.error(`  ❌ Failed to upload ${filename}:`, error.message);
    }
  }

  console.log(`✅ Uploaded ${uploaded} new route files`);
  console.log(`⏭️  Skipped ${alreadyExists} already uploaded files`);
  console.log(`⚠️  Skipped ${skipped} empty routes`);

  return { uploaded, skipped, alreadyExists };
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

  console.log('\n🔥 Top 20 Popular Routes:');
  sorted.forEach((route, i) => {
    console.log(
      `  ${i + 1}. ${route.origin.name} → ${route.destination.name}: ${route.departureCount} departures`
    );
  });

  return sorted;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Train Schedule API Processor (RESUME MODE)');
  console.log('==============================================\n');

  try {
    // Step 1: Check existing files
    const existingFiles = await getExistingFiles();

    // Step 2: Download GTFS
    const gtfsBuffer = await downloadGTFS();

    // Step 3: Parse GTFS files
    const gtfsData = await parseGTFSFiles(gtfsBuffer);

    // Step 4: Filter train data
    const trainData = filterTrainData(gtfsData);

    // Step 5: Generate route pairs
    const routePairs = await generateRoutePairs(trainData);

    // Step 6: Identify popular routes
    const popularRoutes = identifyPopularRoutes(routePairs);

    // Step 7: Upload to Blob Storage (skip existing)
    const { uploaded, skipped, alreadyExists } = await uploadToBlob(routePairs, existingFiles);

    // Step 8: Generate metadata
    const metadata = {
      generated: new Date().toISOString(),
      mode: MODE,
      totalRoutePairs: routePairs.size,
      uploaded,
      alreadyExists,
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
    console.log(`   Already existed: ${alreadyExists}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total in storage: ${uploaded + alreadyExists}`);

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
