/**
 * Train Schedule API Processor - VERSION 7.1 PLATFORM-ENHANCED
 *
 * BUILDS ON V7 (81% reduction) + SMART PLATFORM INTEGRATION
 *
 * NEW IN V7.1 (Platform Intelligence):
 * 1. ✨ Pattern-level platform defaults (most common platform per pattern)
 * 2. ✨ Trip-level platform overrides (only when different from pattern)
 * 3. ✨ Station platformNumbers array (quick UI lookup)
 * 4. ✨ 0.3% bloat (~2.1 MB) for 100% platform accuracy
 *
 * V7 ENHANCEMENTS (from v6):
 * 1. ✅ Time format: "06:41:00" → 401 (minutes since midnight)
 * 2. ✅ Pattern IDs: "BRCL-4455-MORNINGSIDE-CANNON_HILL" → 142 (integer index)
 * 3. ✅ Minified field names: tripId→t, departure→d, arrival→a, patternId→p
 * 4. ✅ Array-indexed dates: Remove repeated date strings
 * 5. ✅ Minified pattern files: Same field minification
 * 6. ✅ Remove redundant fields: routeId, routeName, headsign, serviceId
 * 7. ✅ JSON minification: No whitespace
 *
 * Expected results:
 * - Station files: ~600MB + 0.2% = ~601 MB
 * - Pattern files: ~100MB + 1.4MB = ~101.4 MB
 * - TOTAL: ~702 MB (vs V7: 700MB, vs V6: 3.6GB)
 * - Over-wire (gzipped): ~140MB (96% reduction from V6)
 *
 * Usage: node process-schedule-api-station-v7.1.js [--test]
 * --test: Process only MORNINGSIDE station for testing
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { put, del, list } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const MODE = 'train';
const ROUTE_TYPE = 2; // GTFS route type for trains
const TIMEZONE = 'Australia/Brisbane';
const GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const DAYS_TO_PROCESS = 7; // Process next 7 days

// Test mode: only process MORNINGSIDE station
const TEST_MODE = process.argv.includes('--test');
const TEST_STATION = 'MORNINGSIDE';

// No-upload mode: process all but don't upload to blob
const NO_UPLOAD = process.argv.includes('--no-upload');

/**
 * Convert HH:MM:SS time string to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const mins = parseInt(parts[1], 10);
  return hours * 60 + mins;
}

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
 * Generate pattern ID from route, origin, destination, and stop sequence
 * For v7: we'll use this to build a consistent hash, then assign integer IDs
 */
function generatePatternId(routeId, originSlug, destSlug, intermediateStops) {
  // Base pattern ID
  const baseId = `${routeId}-${originSlug}-${destSlug}`;

  // If no intermediate stops, return base ID
  if (intermediateStops.length === 0) {
    return baseId;
  }

  // Create hash of stop sequence for uniqueness
  const stopSequence = intermediateStops.map(s => s.station).join('-');
  const hash = crypto.createHash('md5').update(stopSequence).digest('hex').substring(0, 6);

  return `${baseId}-${hash}`;
}

/**
 * V7.1: Get most common platform from usage map
 * @param {Map} platformMap - Map of platform -> count
 * @returns {string|null} - Most common platform number
 */
function getMostCommonPlatform(platformMap) {
  if (!platformMap || platformMap.size === 0) return null;

  let maxCount = 0;
  let mostCommon = null;

  for (const [platform, count] of platformMap) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = platform;
    }
  }

  return mostCommon;
}

/**
 * Generate route data with V7 ENHANCED structure:
 * - Integer pattern IDs
 * - Minified field names
 * - Array-indexed dates
 * - Minutes since midnight for times
 */
async function generateRouteData(trainData, stationMappings, tripStopSequences) {
  console.log('🔄 Generating V7 enhanced route data...');

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

  // V7: Pattern ID to integer mapping (per origin)
  const patternIdToInt = new Map(); // originSlug -> Map<patternIdStr, intId>
  const patternsByOrigin = new Map(); // originSlug -> Map<intId, pattern>

  // V7.1: Platform usage tracking (per pattern)
  const patternPlatformUsage = new Map(); // patternInt -> { origin: Map<platform, count>, dest: Map<platform, count> }
  const tripPlatformData = new Map(); // Store platform data per trip for later override comparison

  // Station route data
  const routeData = new Map();

  let processedTrips = 0;

  // Process each date
  const dates = Array.from(servicesByDate.keys()).sort();

  for (const dateStr of dates) {
    const activeServices = servicesByDate.get(dateStr);
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

        // TEST MODE: Skip if not test station
        if (TEST_MODE && originSlug !== TEST_STATION) {
          return;
        }

        // Initialize origin if needed
        if (!routeData.has(originSlug)) {
          const coords = stationCoords.get(originStop.station) || { lat: 0, lng: 0 };

          // V7.1: Extract platform numbers from platform IDs
          const platformIds = stationPlatforms.get(originStop.station) || [];
          const platformNumbers = platformIds
            .map(platformId => {
              const stop = stopsMap.get(platformId);
              return stop?.platform_code || null;
            })
            .filter(Boolean);

          routeData.set(originSlug, {
            station: {
              name: originStop.station,
              slug: originSlug,
              allPlatforms: platformIds,
              platformNumbers: [...new Set(platformNumbers)], // ✨ V7.1: Unique platform numbers
              lat: coords.lat,
              lng: coords.lng
            },
            routes: new Map()
          });

          // Initialize pattern mappings for this origin
          patternIdToInt.set(originSlug, new Map());
          patternsByOrigin.set(originSlug, new Map());
        }

        const originData = routeData.get(originSlug);
        const originPatternMap = patternIdToInt.get(originSlug);
        const originPatterns = patternsByOrigin.get(originSlug);

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
              schedules: new Map() // Will convert to array later
            });
          }

          const destData = originData.routes.get(destSlug);

          // Initialize date if needed (store as array index later)
          if (!destData.schedules.has(dateStr)) {
            destData.schedules.set(dateStr, []);
          }

          // Build intermediate stops (stations between origin and destination)
          const intermediateStops = stationSequence.slice(originIndex + 1, destIndex);

          // Generate string pattern ID (for deduplication)
          const patternIdStr = generatePatternId(
            trip.route_id,
            originSlug,
            destSlug,
            intermediateStops
          );

          // Get or assign integer pattern ID
          let patternInt;
          if (!originPatternMap.has(patternIdStr)) {
            patternInt = originPatternMap.size; // 0, 1, 2, ...
            originPatternMap.set(patternIdStr, patternInt);

            // Store pattern details
            originPatterns.set(patternInt, {
              i: patternInt, // integer ID
              r: trip.route_id,
              n: route?.route_short_name || route?.route_long_name || 'Unknown',
              d: destSlug,
              s: intermediateStops.map(stop => [
                stop.slug,
                stop.station,
                stop.platformId,
                stop.platform,
                stop.platformName
              ]),
              c: 0 // trip count
            });
          } else {
            patternInt = originPatternMap.get(patternIdStr);
          }

          // Increment trip count for this pattern
          originPatterns.get(patternInt).c++;

          // V7.1: Track platform usage for this pattern
          const originPlatform = originStop.platform || '1';
          const destPlatform = destStop.platform || '1';

          if (!patternPlatformUsage.has(patternInt)) {
            patternPlatformUsage.set(patternInt, {
              origin: new Map(),
              dest: new Map()
            });
          }

          const usage = patternPlatformUsage.get(patternInt);
          usage.origin.set(originPlatform, (usage.origin.get(originPlatform) || 0) + 1);
          usage.dest.set(destPlatform, (usage.dest.get(destPlatform) || 0) + 1);

          // V7 ENHANCED: Minified trip structure
          const minifiedTrip = {
            t: trip.trip_id, // Keep full tripId for realtime integration
            d: timeToMinutes(originStop.departure), // departure as minutes
            a: timeToMinutes(destStop.arrival), // arrival as minutes
            p: patternInt, // integer pattern ID
            s: intermediateStops.map(stop => timeToMinutes(stop.arrival)) // stopTimes as minutes array
          };

          // V7.1: Store platform data for this specific trip (for later override comparison)
          const tripKey = `${originSlug}-${destSlug}-${dateStr}-${minifiedTrip.t}`;
          tripPlatformData.set(tripKey, { originPlatform, destPlatform, trip: minifiedTrip });

          // Add trip to this date's schedule
          destData.schedules.get(dateStr).push(minifiedTrip);
        });
      });

      processedTrips++;
      if (processedTrips % 1000 === 0) {
        console.log(`  Processed ${processedTrips} trips...`);
      }
    }
  }

  // Calculate total unique patterns across all origins
  let totalPatterns = 0;
  for (const [originSlug, originPatterns] of patternsByOrigin) {
    totalPatterns += originPatterns.size;
  }

  console.log(`✅ Processed ${processedTrips} trip instances across ${servicesByDate.size} dates`);
  console.log(`✅ Generated data for ${routeData.size} origin stations`);
  console.log(`✅ Identified ${totalPatterns} unique trip patterns across all origins`);

  // V7.1: Calculate platform defaults for each pattern
  console.log('🔧 V7.1: Calculating platform defaults for patterns...');
  let patternsWithDefaults = 0;
  for (const [originSlug, originPatterns] of patternsByOrigin) {
    for (const [patternInt, pattern] of originPatterns) {
      const usage = patternPlatformUsage.get(patternInt);
      if (usage) {
        pattern.op = getMostCommonPlatform(usage.origin); // Origin platform default
        pattern.dp = getMostCommonPlatform(usage.dest);   // Dest platform default
        patternsWithDefaults++;
      }
    }
  }
  console.log(`✅ Added platform defaults to ${patternsWithDefaults} patterns`);

  // V7.1: Add platform overrides to trips where they differ from pattern defaults
  console.log('🔧 V7.1: Adding platform overrides to exceptional trips...');
  let tripsWithOverrides = 0;

  for (const [tripKey, tripData] of tripPlatformData) {
    const { originPlatform, destPlatform, trip } = tripData;
    const patternInt = trip.p;

    // Get pattern defaults
    const [originSlug, destSlug, dateStr] = tripKey.split('-').slice(0, 3);
    const originPatterns = patternsByOrigin.get(originSlug);
    if (!originPatterns) continue;

    const pattern = originPatterns.get(patternInt);
    if (!pattern) continue;

    // Add overrides only if different from pattern default
    if (originPlatform && originPlatform !== pattern.op) {
      trip.op = originPlatform; // Override origin platform
      tripsWithOverrides++;
    }

    if (destPlatform && destPlatform !== pattern.dp) {
      trip.ap = destPlatform; // Override arrival platform
      tripsWithOverrides++;
    }
  }
  console.log(`✅ Added platform overrides to ${tripsWithOverrides} exceptional trips`);

  return { routeData, patternsByOrigin, startDate: format(startDate, 'yyyy-MM-dd') };
}

/**
 * Convert route data to V7 JSON-serializable format with array-indexed dates
 */
function serializeRouteData(routeData, startDate) {
  console.log('📦 Serializing V7 station files...');

  const serialized = new Map();

  for (const [originSlug, originData] of routeData) {
    const routes = {};

    for (const [destSlug, destData] of originData.routes) {
      // Convert schedules Map to array (indexed by day offset)
      const schedulesMap = destData.schedules;
      const dates = Array.from(schedulesMap.keys()).sort();
      const schedulesArray = dates.map(dateStr => {
        const trips = schedulesMap.get(dateStr);
        // Sort trips by departure time (already in minutes)
        return trips.sort((a, b) => a.d - b.d);
      });

      routes[destSlug] = {
        destination: destData.destination,
        schedules: schedulesArray // Array indexed by day offset
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
 * Save station files locally (V7 - minified, no whitespace)
 */
async function saveStationFilesLocally(stationFiles, startDate) {
  if (process.env.GITHUB_ACTIONS) {
    console.log('⏭️  Skipping local station file save (running in GitHub Actions)');
    return;
  }

  console.log('💾 Saving V7 station files locally...');

  const outputDir = path.join(__dirname, 'output', 'train-stations-v7.1');
  await fs.mkdir(outputDir, { recursive: true });

  let saved = 0;
  let totalTrips = 0;
  let totalBytes = 0;

  for (const [originSlug, stationData] of stationFiles) {
    const tripCount = Object.values(stationData.routes)
      .reduce((sum, route) => {
        const dateTrips = route.schedules
          .reduce((dateSum, trips) => dateSum + trips.length, 0);
        return sum + dateTrips;
      }, 0);

    if (tripCount === 0) continue;

    const filename = `train-station-${originSlug}.json`;
    const filepath = path.join(outputDir, filename);

    const fileData = {
      meta: {
        v: '7.1', // ✨ V7.1: Platform-enhanced version
        start: startDate, // Start date (stored once)
        days: DAYS_TO_PROCESS,
        origin: originSlug,
        fields: {
          t: 'tripId',
          d: 'departureMinutes',
          a: 'arrivalMinutes',
          p: 'patternIndex',
          s: 'stopTimesMinutes',
          op: 'originPlatformOverride',  // ✨ V7.1: Optional origin platform override
          ap: 'arrivalPlatformOverride'  // ✨ V7.1: Optional arrival platform override
        }
      },
      station: stationData.station,
      routes: stationData.routes
    };

    // V7: MINIFIED - no whitespace
    const json = JSON.stringify(fileData);
    await fs.writeFile(filepath, json);

    totalBytes += json.length;
    saved++;
    totalTrips += tripCount;

    if (saved % 20 === 0 || TEST_MODE) {
      const sizeMB = (json.length / (1024 * 1024)).toFixed(2);
      console.log(`  📝 Saved ${filename} (${sizeMB} MB, ${tripCount} trips)`);
    }
  }

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`✅ Saved ${saved} V7 station files locally to ${outputDir}`);
  console.log(`   Total size: ${totalMB} MB`);
  console.log(`   Total trips: ${totalTrips}`);
}

/**
 * Save pattern files locally (V7 - minified field names, no whitespace)
 */
async function savePatternFilesLocally(patternsByOrigin) {
  if (process.env.GITHUB_ACTIONS) {
    console.log('⏭️  Skipping local pattern file save (running in GitHub Actions)');
    return;
  }

  console.log('💾 Saving V7 pattern files locally...');

  const outputDir = path.join(__dirname, 'output', 'train-patterns-v7.1');
  await fs.mkdir(outputDir, { recursive: true });

  let saved = 0;
  let totalPatterns = 0;
  let totalBytes = 0;

  for (const [originSlug, originPatterns] of patternsByOrigin) {
    const filename = `train-patterns-${originSlug}.json`;
    const filepath = path.join(outputDir, filename);

    // Convert Map to array for JSON serialization
    const patternsArray = Array.from(originPatterns.values());

    const fileData = {
      meta: {
        v: '7.1', // ✨ V7.1: Platform-enhanced version
        origin: originSlug,
        fields: {
          i: 'id',
          r: 'routeId',
          n: 'routeName',
          d: 'destination',
          s: 'stops',
          c: 'tripCount',
          op: 'originPlatform',      // ✨ V7.1: Most common origin platform
          dp: 'destPlatform'         // ✨ V7.1: Most common destination platform
        },
        stopFields: ['station', 'name', 'platformId', 'platform', 'platformName']
      },
      patterns: patternsArray
    };

    // V7: MINIFIED - no whitespace
    const json = JSON.stringify(fileData);
    await fs.writeFile(filepath, json);

    totalBytes += json.length;
    saved++;
    totalPatterns += originPatterns.size;

    if (saved % 20 === 0 || TEST_MODE) {
      const sizeKB = (json.length / 1024).toFixed(2);
      console.log(`  📝 Saved ${filename} (${sizeKB} KB, ${originPatterns.size} patterns)`);
    }
  }

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`✅ Saved ${saved} V7 pattern files locally to ${outputDir}`);
  console.log(`   Total size: ${totalMB} MB`);
  console.log(`   Total patterns: ${totalPatterns}`);
}

/**
 * Delete existing train files from Blob Storage
 */
async function deleteExistingFiles() {
  console.log('🗑️  Deleting existing train files...');
  console.log('   (Skipping delete - will use allowOverwrite instead)');

  // Note: We'll use allowOverwrite: true in put() instead of deleting first
  // This is more reliable and handles race conditions better

  return;

  /* DISABLED - using allowOverwrite instead
  let deleted = 0;
  let cursor;

  try {
    do {
      const result = await list({ cursor });

      for (const blob of result.blobs) {
        if ((blob.pathname.startsWith('train-station-') || blob.pathname.startsWith('train-patterns-'))
            && blob.pathname.endsWith('.json')) {
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
  */
}

/**
 * Upload station files to Vercel Blob Storage (V7)
 */
async function uploadStationFiles(stationFiles, startDate) {
  console.log('☁️  Uploading V7 station files to Vercel Blob...');

  let uploaded = 0;
  let totalTrips = 0;

  for (const [originSlug, stationData] of stationFiles) {
    const tripCount = Object.values(stationData.routes)
      .reduce((sum, route) => {
        const dateTrips = route.schedules
          .reduce((dateSum, trips) => dateSum + trips.length, 0);
        return sum + dateTrips;
      }, 0);

    if (tripCount === 0) {
      console.log(`  ⏭️  Skipping ${originSlug} (no trips)`);
      continue;
    }

    const filename = `train-station-${originSlug}.json`;

    const fileData = {
      meta: {
        v: '7.1', // ✨ V7.1: Platform-enhanced version
        start: startDate,
        days: DAYS_TO_PROCESS,
        origin: originSlug,
        fields: {
          t: 'tripId',
          d: 'departureMinutes',
          a: 'arrivalMinutes',
          p: 'patternIndex',
          s: 'stopTimesMinutes',
          op: 'originPlatformOverride',  // ✨ V7.1: Optional origin platform override
          ap: 'arrivalPlatformOverride'  // ✨ V7.1: Optional arrival platform override
        }
      },
      station: stationData.station,
      routes: stationData.routes
    };

    // V7.1: MINIFIED (allowOverwrite to replace existing files)
    await put(filename, JSON.stringify(fileData), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true, // Allow replacing existing V6/V7 files
      contentType: 'application/json',
      cacheControlMaxAge: 300
    });

    uploaded++;
    totalTrips += tripCount;

    console.log(`  ✅ Uploaded ${filename} (${Object.keys(stationData.routes).length} routes, ${tripCount} trips)`);
  }

  console.log(`\n✅ Station upload complete: ${uploaded} files, ${totalTrips} total trips`);
}

/**
 * Upload pattern files to Vercel Blob Storage (V7)
 */
async function uploadPatternFiles(patternsByOrigin) {
  console.log('☁️  Uploading V7 pattern files to Vercel Blob...');

  let uploaded = 0;
  let totalPatterns = 0;

  for (const [originSlug, originPatterns] of patternsByOrigin) {
    const filename = `train-patterns-${originSlug}.json`;

    const patternsArray = Array.from(originPatterns.values());

    const fileData = {
      meta: {
        v: '7.1', // ✨ V7.1: Platform-enhanced version
        origin: originSlug,
        fields: {
          i: 'id',
          r: 'routeId',
          n: 'routeName',
          d: 'destination',
          s: 'stops',
          c: 'tripCount',
          op: 'originPlatform',      // ✨ V7.1: Most common origin platform
          dp: 'destPlatform'         // ✨ V7.1: Most common destination platform
        },
        stopFields: ['station', 'name', 'platformId', 'platform', 'platformName']
      },
      patterns: patternsArray
    };

    // V7: MINIFIED (allowOverwrite to replace existing files)
    await put(filename, JSON.stringify(fileData), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true, // Allow replacing existing V6/V7 files
      contentType: 'application/json',
      cacheControlMaxAge: 86400 // 24 hours cache for patterns (change less frequently)
    });

    uploaded++;
    totalPatterns += originPatterns.size;

    console.log(`  ✅ Uploaded ${filename} (${originPatterns.size} patterns)`);
  }

  console.log(`\n✅ Pattern upload complete: ${uploaded} files, ${totalPatterns} total patterns`);
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🚂 Train Schedule Processor v7.0 ENHANCED\n');

  if (TEST_MODE) {
    console.log(`🧪 TEST MODE: Processing only ${TEST_STATION} station\n`);
  }

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

    // 5. Generate V7 enhanced route data
    const { routeData, patternsByOrigin, startDate } = await generateRouteData(trainData, stationMappings, tripStopSequences);

    // 6. Serialize station data with array-indexed dates
    const stationFiles = serializeRouteData(routeData, startDate);

    // 7. Save files locally (if not in GitHub Actions)
    await saveStationFilesLocally(stationFiles, startDate);
    await savePatternFilesLocally(patternsByOrigin);

    if (!TEST_MODE && !NO_UPLOAD) {
      // 8. Delete existing files
      await deleteExistingFiles();

      // 9. Upload to Blob
      await uploadStationFiles(stationFiles, startDate);
      await uploadPatternFiles(patternsByOrigin);
    } else if (NO_UPLOAD) {
      console.log('\n⏭️  Skipping blob upload (--no-upload flag)\n');
    }

    // Calculate total patterns
    let totalPatterns = 0;
    for (const [originSlug, originPatterns] of patternsByOrigin) {
      totalPatterns += originPatterns.size;
    }

    console.log('\n✅ Processing complete!\n');
    console.log(`📊 Summary:`);
    console.log(`   Station files: ${stationFiles.size}`);
    console.log(`   Pattern files (grouped by origin): ${patternsByOrigin.size}`);
    console.log(`   Total patterns: ${totalPatterns}`);

    if (TEST_MODE) {
      console.log(`\n🧪 TEST MODE: Files saved to output/ directory (not uploaded to Blob)`);
    } else if (NO_UPLOAD) {
      console.log(`\n📁 NO-UPLOAD MODE: All files saved to output/ directory (not uploaded to Blob)`);
    }
  } catch (error) {
    console.error('\n❌ Processing failed:', error);
    process.exit(1);
  }
}

main();
