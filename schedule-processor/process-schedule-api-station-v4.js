/**
 * Train Schedule API Processor - VERSION 4.0
 *
 * PROPER FIX: Based on ferry processor pattern
 *
 * Key improvements:
 * 1. Build station connectivity from actual trip patterns
 * 2. Only create routes for valid station pairs (where dest appears AFTER origin)
 * 3. Platform abstraction: Platforms are metadata only, routes are station-to-station
 * 4. Filter by active services (no duplicate schedules for different days)
 *
 * Usage: node process-schedule-api-station-v4.js
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { put, del, list } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const MODE = 'train';
const ROUTE_TYPE = 2; // GTFS route type for trains
const TIMEZONE = 'Australia/Brisbane';
const GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const DAYS_TO_PROCESS = 1; // Process next 24 hours only

/**
 * Build platform-to-station mapping from grouped stations file
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

      // Create URL-safe slug
      const slug = stationName
        .replace(/\s+station$/i, '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

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
    dynamicTyping: false
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

  const trainRouteIds = new Set(trainRoutes.map(r => r.route_id));

  // Filter trips for train routes
  const trainTrips = gtfsData['trips.txt'].filter(
    trip => trainRouteIds.has(trip.route_id)
  );

  // Filter stop_times for train trips
  const trainTripIds = new Set(trainTrips.map(t => t.trip_id));
  const trainStopTimes = gtfsData['stop_times.txt'].filter(
    st => trainTripIds.has(st.trip_id)
  );

  console.log(`✅ Filtered ${trainRoutes.length} routes, ${trainTrips.length} trips, ${trainStopTimes.length} stop_times`);

  return {
    routes: trainRoutes,
    trips: trainTrips,
    stopTimes: trainStopTimes,
    stops: gtfsData['stops.txt'],
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
 * Build station connectivity from trip patterns
 * NOTE: This builds a connectivity map for reference, but route validation
 * is done per-trip to ensure correct direction (see generateRoutePairs)
 */
function buildStationConnectivity(trainData, stationMappings) {
  console.log('🔗 Building trip stop sequences...');

  const { platformToStation, stationSlugs } = stationMappings;

  // Build stop sequence for each trip (at PLATFORM level first)
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

  // Convert platform sequences to STATION sequences
  const stationConnectivity = new Map(); // origin station slug -> Set of dest station slugs

  tripStopSequences.forEach((platformStops, tripId) => {
    // Convert platform IDs to station names
    const stationSequence = [];
    const seenStations = new Set();

    platformStops.forEach(platformStop => {
      const stationName = platformToStation.get(platformStop.stopId);
      if (stationName && !seenStations.has(stationName)) {
        stationSequence.push(stationName);
        seenStations.add(stationName);
      }
    });

    // Now build connectivity: for each station, all subsequent stations are valid destinations
    stationSequence.forEach((originStation, originIndex) => {
      const originSlug = stationSlugs.get(originStation);
      if (!originSlug) return;

      if (!stationConnectivity.has(originSlug)) {
        stationConnectivity.set(originSlug, new Set());
      }

      // Add all stations after this one as valid destinations
      for (let i = originIndex + 1; i < stationSequence.length; i++) {
        const destStation = stationSequence[i];
        const destSlug = stationSlugs.get(destStation);
        if (destSlug) {
          stationConnectivity.get(originSlug).add(destSlug);
        }
      }
    });
  });

  // Convert Sets to Arrays and log connectivity stats
  const connectivityObject = {};
  stationConnectivity.forEach((destinations, origin) => {
    connectivityObject[origin] = Array.from(destinations).sort();
  });

  const totalConnections = Object.values(connectivityObject).reduce((sum, dests) => sum + dests.length, 0);
  console.log(`✅ Built connectivity for ${Object.keys(connectivityObject).length} origin stations`);
  console.log(`   Total valid station pairs: ${totalConnections}`);

  return { connectivity: connectivityObject, tripStopSequences };
}

/**
 * Generate route pairs using connectivity-based approach
 * ONLY creates routes for valid station pairs!
 */
async function generateRoutePairs(trainData, stationMappings, stationConnectivity) {
  console.log('🔄 Generating station-to-station routes based on connectivity...');

  const startDate = startOfDay(new Date());
  const endDate = addDays(startDate, DAYS_TO_PROCESS);

  const { platformToStation, stationSlugs, stationPlatforms } = stationMappings;
  const { connectivity, tripStopSequences } = stationConnectivity;

  // Get active services for today only
  const servicesByDate = getActiveServices(
    trainData.calendar,
    trainData.calendarDates,
    startDate,
    endDate
  );

  // Flatten active services
  const allActiveServices = new Set();
  servicesByDate.forEach(services => {
    services.forEach(service => allActiveServices.add(service));
  });

  console.log(`  Active services: ${allActiveServices.size}`);

  // Create maps for quick lookup
  const stopsMap = new Map(trainData.stops.map(stop => [stop.stop_id, stop]));
  const routesMap = new Map(trainData.routes.map(route => [route.route_id, route]));

  // Route pairs keyed by "ORIGIN_SLUG-DEST_SLUG"
  const routePairs = new Map();
  let validTripsProcessed = 0;
  let invalidTripsSkipped = 0;

  // Process each trip
  for (const trip of trainData.trips) {
    // SKIP if service not active today
    if (!allActiveServices.has(trip.service_id)) {
      invalidTripsSkipped++;
      continue;
    }

    const stops = tripStopSequences.get(trip.trip_id);
    if (!stops || stops.length < 2) continue;

    const route = routesMap.get(trip.route_id);

    // Convert platform sequence to station sequence
    const stationSequence = [];
    const seenStations = new Set();
    const platformMap = new Map(); // station -> first platform encountered

    stops.forEach(platformStop => {
      const stationName = platformToStation.get(platformStop.stopId);
      if (stationName && !seenStations.has(stationName)) {
        stationSequence.push({
          station: stationName,
          slug: stationSlugs.get(stationName),
          platformId: platformStop.stopId,
          departure: platformStop.departure,
          arrival: platformStop.arrival
        });
        seenStations.add(stationName);
        platformMap.set(stationName, platformStop.stopId);
      }
    });

    // Now create departures ONLY for valid station pairs
    // IMPORTANT: Don't use global connectivity - validate per-trip to ensure correct direction!
    stationSequence.forEach((originStationData, originIndex) => {
      const originSlug = originStationData.slug;

      // Only process destinations that come AFTER origin in THIS trip's sequence
      stationSequence.slice(originIndex + 1).forEach(destStationData => {
        const destSlug = destStationData.slug;

        const pairKey = `${originSlug}-${destSlug}`;

        // Initialize route pair if first time
        if (!routePairs.has(pairKey)) {
          const originStop = stopsMap.get(originStationData.platformId);
          const destStop = stopsMap.get(destStationData.platformId);

          routePairs.set(pairKey, {
            origin: {
              station: originStationData.station,
              slug: originSlug,
              allPlatforms: stationPlatforms.get(originStationData.station),
              lat: parseFloat(originStop?.stop_lat || '0'),
              lng: parseFloat(originStop?.stop_lon || '0')
            },
            destination: {
              station: destStationData.station,
              slug: destSlug,
              allPlatforms: stationPlatforms.get(destStationData.station),
              lat: parseFloat(destStop?.stop_lat || '0'),
              lng: parseFloat(destStop?.stop_lon || '0')
            },
            departures: []
          });
        }

        // Add departure with platform details
        const originPlatformStop = stopsMap.get(originStationData.platformId);
        const destPlatformStop = stopsMap.get(destStationData.platformId);

        routePairs.get(pairKey).departures.push({
          tripId: trip.trip_id,
          routeId: trip.route_id,
          routeName: route?.route_short_name || route?.route_long_name || 'Unknown',
          headsign: trip.trip_headsign || '',
          scheduledDeparture: originStationData.departure,
          scheduledArrival: destStationData.arrival,
          serviceId: trip.service_id,
          platform: originPlatformStop?.platform_code || null,
          platformDetails: {
            origin: {
              id: originStationData.platformId,
              number: originPlatformStop?.platform_code || null,
              name: originPlatformStop?.stop_name || 'Unknown'
            },
            destination: {
              id: destStationData.platformId,
              number: destPlatformStop?.platform_code || null,
              name: destPlatformStop?.stop_name || 'Unknown'
            }
          }
        });
      });
    });

    validTripsProcessed++;
    if (validTripsProcessed % 1000 === 0) {
      console.log(`  Processed ${validTripsProcessed} valid trips...`);
    }
  }

  console.log(`✅ Processed ${validTripsProcessed} active trips, skipped ${invalidTripsSkipped} inactive`);
  console.log(`✅ Generated ${routePairs.size} valid station pairs`);

  return routePairs;
}

/**
 * Group routes by origin station (for per-station file architecture)
 */
function groupByOriginStation(routePairs) {
  console.log('📁 Grouping routes by origin station...');

  const stationFiles = new Map();

  routePairs.forEach((routeData, pairKey) => {
    const originSlug = routeData.origin.slug;

    if (!stationFiles.has(originSlug)) {
      stationFiles.set(originSlug, {
        station: {
          name: routeData.origin.station,
          slug: originSlug,
          allPlatforms: routeData.origin.allPlatforms,
          lat: routeData.origin.lat,
          lng: routeData.origin.lng
        },
        routes: {}
      });
    }

    const destSlug = routeData.destination.slug;
    stationFiles.get(originSlug).routes[destSlug] = {
      destination: routeData.destination,
      departures: routeData.departures
    };
  });

  console.log(`✅ Created ${stationFiles.size} station files`);

  return stationFiles;
}

/**
 * Delete existing train station files from Blob Storage
 */
async function deleteExistingFiles() {
  console.log('🗑️  Deleting existing train station files...');

  let deleted = 0;
  let cursor;

  try {
    do {
      const result = await list({ cursor });

      for (const blob of result.blobs) {
        if (blob.pathname.startsWith('train-station-') && blob.pathname.endsWith('.json')) {
          await del(blob.url);
          deleted++;
        }
      }

      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    console.log(`✅ Deleted ${deleted} existing files`);
  } catch (error) {
    console.warn('⚠️  Error deleting files:', error.message);
  }
}

/**
 * Upload station files to Vercel Blob Storage
 */
async function uploadToBlob(stationFiles) {
  console.log('☁️  Uploading to Vercel Blob Storage...');

  let uploaded = 0;
  let totalDepartures = 0;

  for (const [originSlug, stationData] of stationFiles) {
    // Count departures
    const departureCount = Object.values(stationData.routes)
      .reduce((sum, route) => sum + route.departures.length, 0);

    if (departureCount === 0) {
      console.log(`  ⏭️  Skipping ${originSlug} (no departures)`);
      continue;
    }

    const filename = `train-station-${originSlug}.json`;

    const fileData = {
      station: stationData.station,
      totalRoutes: Object.keys(stationData.routes).length,
      routes: stationData.routes,
      generated: new Date().toISOString()
    };

    const blob = await put(filename, JSON.stringify(fileData), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    uploaded++;
    totalDepartures += departureCount;

    console.log(`  ✅ Uploaded ${filename} (${Object.keys(stationData.routes).length} routes, ${departureCount} departures)`);
  }

  console.log(`\n✅ Upload complete: ${uploaded} files, ${totalDepartures} total departures`);
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🚂 Train Schedule Processor v4.0 - Connectivity-Based\n');

  try {
    // 1. Build station mappings
    const stationMappings = await buildStationMappings();

    // 2. Download and parse GTFS
    const gtfsBuffer = await downloadGTFS();
    const gtfsData = await parseGTFSFiles(gtfsBuffer);

    // 3. Filter train data
    const trainData = filterTrainData(gtfsData);

    // 4. Build station connectivity (THE KEY FIX)
    const stationConnectivity = buildStationConnectivity(trainData, stationMappings);

    // 5. Generate route pairs using connectivity
    const routePairs = await generateRoutePairs(trainData, stationMappings, stationConnectivity);

    // 6. Group by origin station
    const stationFiles = groupByOriginStation(routePairs);

    // 7. Delete existing files
    await deleteExistingFiles();

    // 8. Upload to Blob
    await uploadToBlob(stationFiles);

    console.log('\n✅ Processing complete!\n');
  } catch (error) {
    console.error('\n❌ Processing failed:', error);
    process.exit(1);
  }
}

main();
