/**
 * Train Schedule API Processor - VERSION 5.0
 *
 * NEW DATA MODEL: Origin -> Destination -> Date -> Trips
 *
 * Key improvements over v4:
 * 1. Date-based organization of trips
 * 2. Complete trip metadata with intermediate stops
 * 3. Full arrival/departure details for origin and destination
 * 4. Intermediate stop sequences for journey visualization
 * 5. Optimized for departure board UX and realtime data integration
 *
 * Data structure:
 * {
 *   station: { name, slug, platforms, lat, lng },
 *   routes: {
 *     DESTINATION_SLUG: {
 *       destination: { name, slug, platforms, lat, lng },
 *       schedules: {
 *         "2025-11-02": [
 *           {
 *             tripId, routeId, routeName, headsign,
 *             departure: { time, platform, platformId, platformName },
 *             arrival: { time, platform, platformId, platformName },
 *             intermediateStops: [ { station, stationName, arrival, departure, platform } ],
 *             serviceId
 *           }
 *         ]
 *       }
 *     }
 *   }
 * }
 *
 * Usage: node process-schedule-api-station-v5.js
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
const DAYS_TO_PROCESS = 7; // Process next 7 days

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
    const stationCoords = new Map(); // station name -> { lat, lng }

    groupedData.stations.forEach(station => {
      const stationName = station.name;

      // Create URL-safe slug (match v4 logic exactly)
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

    return { platformToStation, stationSlugs, stationPlatforms, stationCoords };
  } catch (error) {
    console.error('❌ Error building station mappings:', error);
    throw error;
  }
}

/**
 * Download GTFS data
 */
async function downloadGTFS() {
  console.log('📥 Downloading GTFS data from TransLink...');

  const response = await fetch(GTFS_URL);
  if (!response.ok) {
    throw new Error(`Failed to download GTFS: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  console.log(`✅ Downloaded ${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  return buffer;
}

/**
 * Parse GTFS ZIP file
 */
async function parseGTFSFiles(buffer) {
  console.log('📦 Extracting GTFS files...');

  const zip = await JSZip.loadAsync(buffer);
  const gtfsData = {};

  const filesToParse = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt'];

  for (const filename of filesToParse) {
    const file = zip.file(filename);
    if (!file) {
      console.warn(`⚠️  ${filename} not found in GTFS`);
      continue;
    }

    const text = await file.async('text');
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    gtfsData[filename] = parsed.data;
    console.log(`  ✓ ${filename}: ${parsed.data.length} records`);
  }

  return gtfsData;
}

/**
 * Filter GTFS data for trains only
 */
function filterTrainData(gtfsData) {
  console.log('🚂 Filtering train data...');

  const trainRoutes = gtfsData['routes.txt'].filter(
    route => route.route_type === String(ROUTE_TYPE)
  );

  const trainRouteIds = new Set(trainRoutes.map(r => r.route_id));

  const trainTrips = gtfsData['trips.txt'].filter(
    trip => trainRouteIds.has(trip.route_id)
  );

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

    servicesByDate.set(format(currentDate, 'yyyy-MM-dd'), Array.from(activeServices));
    currentDate = addDays(currentDate, 1);
  }

  return servicesByDate;
}

/**
 * Build trip stop sequences
 * Returns Map of tripId -> ordered array of stops with station info
 * Also populates stationCoords map
 */
function buildTripStopSequences(trainData, stationMappings) {
  console.log('🔗 Building trip stop sequences...');

  const { platformToStation, stationSlugs, stationCoords } = stationMappings;
  const stopsMap = new Map(trainData.stops.map(stop => [stop.stop_id, stop]));

  // Build stop sequence for each trip at PLATFORM level
  const tripPlatformSequences = new Map();

  trainData.stopTimes.forEach(st => {
    if (!tripPlatformSequences.has(st.trip_id)) {
      tripPlatformSequences.set(st.trip_id, []);
    }

    tripPlatformSequences.get(st.trip_id).push({
      stopId: st.stop_id,
      sequence: parseInt(st.stop_sequence || '0'),
      arrival: st.arrival_time,
      departure: st.departure_time
    });
  });

  // Sort each trip's stops by sequence
  for (const [tripId, stops] of tripPlatformSequences) {
    stops.sort((a, b) => a.sequence - b.sequence);
  }

  // Convert platform sequences to station sequences
  const tripStationSequences = new Map();

  for (const [tripId, platformStops] of tripPlatformSequences) {
    const stationSequence = [];
    const seenStations = new Set();

    platformStops.forEach(platformStop => {
      const stationName = platformToStation.get(platformStop.stopId);

      if (stationName && !seenStations.has(stationName)) {
        const stopDetails = stopsMap.get(platformStop.stopId);

        // Store coordinates for this station (first time we see it)
        if (!stationCoords.has(stationName) && stopDetails) {
          stationCoords.set(stationName, {
            lat: parseFloat(stopDetails.stop_lat || '0'),
            lng: parseFloat(stopDetails.stop_lon || '0')
          });
        }

        stationSequence.push({
          station: stationName,
          slug: stationSlugs.get(stationName),
          platformId: platformStop.stopId,
          platform: stopDetails?.platform_code || null,
          platformName: stopDetails?.stop_name || 'Unknown',
          arrival: platformStop.arrival,
          departure: platformStop.departure,
          sequence: platformStop.sequence
        });

        seenStations.add(stationName);
      }
    });

    if (stationSequence.length >= 2) {
      tripStationSequences.set(tripId, stationSequence);
    }
  }

  console.log(`✅ Built ${tripStationSequences.size} trip sequences`);

  return tripStationSequences;
}

/**
 * Generate route data with new structure:
 * Origin -> Destination -> Date -> Trips (with intermediate stops)
 */
async function generateRouteData(trainData, stationMappings, tripStopSequences) {
  console.log('🔄 Generating route data with new structure...');

  const startDate = startOfDay(new Date());
  const endDate = addDays(startDate, DAYS_TO_PROCESS);

  const { platformToStation, stationSlugs, stationPlatforms, stationCoords } = stationMappings;

  // Get active services per date
  const servicesByDate = getActiveServices(
    trainData.calendar,
    trainData.calendarDates,
    startDate,
    endDate
  );

  console.log(`  Processing ${servicesByDate.size} dates`);

  // Create maps for quick lookup
  const stopsMap = new Map(trainData.stops.map(stop => [stop.stop_id, stop]));
  const routesMap = new Map(trainData.routes.map(route => [route.route_id, route]));
  const tripsMap = new Map(trainData.trips.map(trip => [trip.trip_id, trip]));

  // Data structure: originSlug -> destSlug -> date -> trips[]
  const routeData = new Map();

  let processedTrips = 0;
  let skippedTrips = 0;

  // Process each date
  for (const [dateStr, activeServices] of servicesByDate) {
    const activeServiceSet = new Set(activeServices);

    // Process each trip
    for (const [tripId, stationSequence] of tripStopSequences) {
      const trip = tripsMap.get(tripId);

      // Skip if service not active on this date
      if (!trip || !activeServiceSet.has(trip.service_id)) {
        continue;
      }

      const route = routesMap.get(trip.route_id);

      // For each origin station in the trip
      stationSequence.forEach((originStop, originIndex) => {
        const originSlug = originStop.slug;

        // Initialize origin if needed
        if (!routeData.has(originSlug)) {
          const coords = stationCoords.get(originStop.station) || { lat: 0, lng: 0 };

          routeData.set(originSlug, {
            station: {
              name: originStop.station,
              slug: originSlug,
              allPlatforms: stationPlatforms.get(originStop.station),
              lat: coords.lat,
              lng: coords.lng
            },
            routes: new Map()
          });
        }

        const originData = routeData.get(originSlug);

        // For each destination AFTER origin in sequence
        stationSequence.slice(originIndex + 1).forEach((destStop, relativeIndex) => {
          const destSlug = destStop.slug;
          const destIndex = originIndex + relativeIndex + 1;

          // Initialize destination if needed
          if (!originData.routes.has(destSlug)) {
            const destCoords = stationCoords.get(destStop.station) || { lat: 0, lng: 0 };

            originData.routes.set(destSlug, {
              destination: {
                name: destStop.station,
                slug: destSlug,
                allPlatforms: stationPlatforms.get(destStop.station),
                lat: destCoords.lat,
                lng: destCoords.lng
              },
              schedules: new Map()
            });
          }

          const destData = originData.routes.get(destSlug);

          // Initialize date if needed
          if (!destData.schedules.has(dateStr)) {
            destData.schedules.set(dateStr, []);
          }

          // Build intermediate stops (stations between origin and destination)
          const intermediateStops = stationSequence
            .slice(originIndex + 1, destIndex)
            .map(stop => ({
              station: stop.slug,
              stationName: stop.station,
              arrival: stop.arrival,
              departure: stop.departure,
              platform: stop.platform,
              platformId: stop.platformId,
              platformName: stop.platformName
            }));

          // Add trip to this date's schedule
          destData.schedules.get(dateStr).push({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            routeName: route?.route_short_name || route?.route_long_name || 'Unknown',
            headsign: trip.trip_headsign || '',

            departure: {
              time: originStop.departure,
              platform: originStop.platform,
              platformId: originStop.platformId,
              platformName: originStop.platformName
            },

            arrival: {
              time: destStop.arrival,
              platform: destStop.platform,
              platformId: destStop.platformId,
              platformName: destStop.platformName
            },

            intermediateStops: intermediateStops,

            serviceId: trip.service_id
          });
        });
      });

      processedTrips++;
      if (processedTrips % 1000 === 0) {
        console.log(`  Processed ${processedTrips} trips...`);
      }
    }
  }

  console.log(`✅ Processed ${processedTrips} trip instances across ${servicesByDate.size} dates`);
  console.log(`✅ Generated data for ${routeData.size} origin stations`);

  return routeData;
}

/**
 * Convert route data to JSON-serializable format
 */
function serializeRouteData(routeData) {
  console.log('📦 Serializing route data...');

  const serialized = new Map();

  for (const [originSlug, originData] of routeData) {
    const routes = {};

    for (const [destSlug, destData] of originData.routes) {
      const schedules = {};

      for (const [date, trips] of destData.schedules) {
        // Sort trips by departure time
        schedules[date] = trips.sort((a, b) =>
          a.departure.time.localeCompare(b.departure.time)
        );
      }

      routes[destSlug] = {
        destination: destData.destination,
        schedules: schedules
      };
    }

    serialized.set(originSlug, {
      station: originData.station,
      routes: routes
    });
  }

  console.log(`✅ Serialized ${serialized.size} station files`);

  return serialized;
}

/**
 * Save station files locally (only when not in GitHub Actions)
 */
async function saveFilesLocally(stationFiles) {
  // Skip if running in GitHub Actions
  if (process.env.GITHUB_ACTIONS) {
    console.log('⏭️  Skipping local file save (running in GitHub Actions)');
    return;
  }

  console.log('💾 Saving files locally...');

  const outputDir = path.join(__dirname, 'output', 'train-stations-v5');

  // Create output directory if it doesn't exist
  await fs.mkdir(outputDir, { recursive: true });

  let saved = 0;
  let totalTrips = 0;

  for (const [originSlug, stationData] of stationFiles) {
    // Count total trips across all destinations and dates
    const tripCount = Object.values(stationData.routes)
      .reduce((sum, route) => {
        const dateTrips = Object.values(route.schedules)
          .reduce((dateSum, trips) => dateSum + trips.length, 0);
        return sum + dateTrips;
      }, 0);

    if (tripCount === 0) {
      continue;
    }

    const filename = `train-station-${originSlug}.json`;
    const filepath = path.join(outputDir, filename);

    const fileData = {
      station: stationData.station,
      totalRoutes: Object.keys(stationData.routes).length,
      routes: stationData.routes,
      generated: new Date().toISOString(),
      version: '5.0'
    };

    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2));

    saved++;
    totalTrips += tripCount;

    if (saved % 20 === 0) {
      console.log(`  📝 Saved ${saved} files...`);
    }
  }

  console.log(`✅ Saved ${saved} files locally to ${outputDir}`);
  console.log(`   Total trips: ${totalTrips}`);
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
  let totalTrips = 0;

  for (const [originSlug, stationData] of stationFiles) {
    // Count total trips
    const tripCount = Object.values(stationData.routes)
      .reduce((sum, route) => {
        const dateTrips = Object.values(route.schedules)
          .reduce((dateSum, trips) => dateSum + trips.length, 0);
        return sum + dateTrips;
      }, 0);

    if (tripCount === 0) {
      console.log(`  ⏭️  Skipping ${originSlug} (no trips)`);
      continue;
    }

    const filename = `train-station-${originSlug}.json`;

    const fileData = {
      station: stationData.station,
      totalRoutes: Object.keys(stationData.routes).length,
      routes: stationData.routes,
      generated: new Date().toISOString(),
      version: '5.0'
    };

    const blob = await put(filename, JSON.stringify(fileData), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    uploaded++;
    totalTrips += tripCount;

    console.log(`  ✅ Uploaded ${filename} (${Object.keys(stationData.routes).length} routes, ${tripCount} trips)`);
  }

  console.log(`\n✅ Upload complete: ${uploaded} files, ${totalTrips} total trips`);
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🚂 Train Schedule Processor v5.0 - Date-Based Trip Organization\n');

  try {
    // 1. Build station mappings
    const stationMappings = await buildStationMappings();

    // 2. Download and parse GTFS
    const gtfsBuffer = await downloadGTFS();
    const gtfsData = await parseGTFSFiles(gtfsBuffer);

    // 3. Filter train data
    const trainData = filterTrainData(gtfsData);

    // 4. Build trip stop sequences
    const tripStopSequences = buildTripStopSequences(trainData, stationMappings);

    // 5. Generate route data with new structure
    const routeData = await generateRouteData(trainData, stationMappings, tripStopSequences);

    // 6. Serialize to JSON-compatible format
    const stationFiles = serializeRouteData(routeData);

    // 7. Save files locally (if not in GitHub Actions)
    await saveFilesLocally(stationFiles);

    // 8. Delete existing files
    await deleteExistingFiles();

    // 9. Upload to Blob
    await uploadToBlob(stationFiles);

    console.log('\n✅ Processing complete!\n');
  } catch (error) {
    console.error('\n❌ Processing failed:', error);
    process.exit(1);
  }
}

main();
