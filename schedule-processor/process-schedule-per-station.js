/**
 * Train Schedule API Processor - PER-STATION ARCHITECTURE
 * VERSION: 4.0 - Optimal Design
 *
 * Generates 154 station files (one per origin station)
 * Each file contains ALL routes FROM that station
 *
 * Benefits:
 * - 154 files instead of 8,016 (98% reduction)
 * - 10 minute upload instead of 5-6 hours
 * - Perfect CDN caching (cache by origin station)
 * - Optimal for user browsing pattern
 *
 * Usage: node process-schedule-per-station.js
 */

import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, addDays, startOfDay } from 'date-fns';
import { put } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const MODE = 'train';
const ROUTE_TYPE = 2;
const GTFS_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const DAYS_TO_PROCESS = 7;

/**
 * Build platform-to-station mapping
 */
async function buildStationMappings() {
  const groupedData = JSON.parse(
    await fs.readFile(path.join(__dirname, 'train-stations-grouped.json'), 'utf-8')
  );

  const platformToStation = new Map();
  const stationSlugs = new Map();
  const stationPlatforms = new Map();
  const stations = new Map(); // Full station data

  groupedData.stations.forEach(station => {
    const stationName = station.name;
    const slug = stationName
      .replace(/\s+station$/i, '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    stationSlugs.set(stationName, slug);
    stationPlatforms.set(stationName, station.stopIds);
    stations.set(stationName, {
      name: stationName,
      slug,
      platforms: station.stopIds
    });

    station.stopIds.forEach(platformId => {
      platformToStation.set(platformId, stationName);
    });
  });

  console.log(`✅ Built mappings for ${stationSlugs.size} stations, ${platformToStation.size} platforms`);
  return { platformToStation, stationSlugs, stationPlatforms, stations };
}

function parseCSV(content) {
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false
  });
  return result.data;
}

async function downloadGTFS() {
  console.log('📥 Downloading GTFS data from TransLink...');
  const response = await fetch(GTFS_URL);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const buffer = await response.arrayBuffer();
  console.log(`✅ Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
  return buffer;
}

async function parseGTFSFiles(gtfsBuffer) {
  console.log('📦 Extracting GTFS files...');
  const zip = await JSZip.loadAsync(gtfsBuffer);
  const files = {};

  const requiredFiles = [
    'stops.txt', 'routes.txt', 'trips.txt',
    'stop_times.txt', 'calendar.txt', 'calendar_dates.txt'
  ];

  for (const filename of requiredFiles) {
    const file = zip.file(filename);
    if (!file) {
      console.warn(`⚠️  ${filename} not found`);
      files[filename] = [];
      continue;
    }
    const content = await file.async('text');
    files[filename] = parseCSV(content);
    console.log(`  ✓ ${filename}: ${files[filename].length} records`);
  }
  return files;
}

function filterTrainData(gtfsData) {
  console.log('🚂 Filtering train data...');

  const trainRoutes = gtfsData['routes.txt'].filter(
    route => route.route_type === String(ROUTE_TYPE)
  );
  const routeIds = new Set(trainRoutes.map(r => r.route_id));

  const trainTrips = gtfsData['trips.txt'].filter(
    trip => routeIds.has(trip.route_id)
  );
  const tripIds = new Set(trainTrips.map(t => t.trip_id));

  const trainStopTimes = gtfsData['stop_times.txt'].filter(
    st => tripIds.has(st.trip_id)
  );

  const stopIds = new Set(trainStopTimes.map(st => st.stop_id));
  const trainStops = gtfsData['stops.txt'].filter(
    stop => stopIds.has(stop.stop_id)
  );

  console.log(`  Found ${trainRoutes.length} routes, ${trainTrips.length} trips, ${trainStops.length} stops`);

  return {
    routes: trainRoutes,
    trips: trainTrips,
    stopTimes: trainStopTimes,
    stops: trainStops,
    calendar: gtfsData['calendar.txt'],
    calendarDates: gtfsData['calendar_dates.txt']
  };
}

function getActiveServices(calendar, calendarDates, startDate, endDate) {
  const servicesByDate = new Map();
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayOfWeek = format(currentDate, 'EEEE').toLowerCase();
    const dateStr = format(currentDate, 'yyyyMMdd');
    const activeServices = new Set();

    calendar.forEach(service => {
      const serviceStart = parse(service.start_date, 'yyyyMMdd', new Date());
      const serviceEnd = parse(service.end_date, 'yyyyMMdd', new Date());
      if (currentDate >= serviceStart && currentDate <= serviceEnd && service[dayOfWeek] === '1') {
        activeServices.add(service.service_id);
      }
    });

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
 * Generate PER-STATION files
 * Each station file contains ALL routes FROM that station
 */
async function generatePerStationFiles(trainData) {
  console.log('🔄 Generating per-station route files...');

  const startDate = startOfDay(new Date());
  const endDate = addDays(startDate, DAYS_TO_PROCESS);

  const { platformToStation, stationSlugs, stationPlatforms, stations } = await buildStationMappings();

  const servicesByDate = getActiveServices(
    trainData.calendar,
    trainData.calendarDates,
    startDate,
    endDate
  );

  // Build trip sequences
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

  for (const [tripId, stops] of tripStopSequences) {
    stops.sort((a, b) => a.sequence - b.sequence);
  }

  const stopsMap = new Map(trainData.stops.map(stop => [stop.stop_id, stop]));
  const routesMap = new Map(trainData.routes.map(route => [route.route_id, route]));

  // Create per-station data structure
  // Map<originStationName, Map<destStationName, departures[]>>
  const perStationData = new Map();

  // Initialize all stations
  for (const [stationName, stationInfo] of stations) {
    perStationData.set(stationName, {
      station: stationInfo,
      routes: new Map()
    });
  }

  let tripsProcessed = 0;
  let departuresAdded = 0;

  // Process all trips
  for (const trip of trainData.trips) {
    const stops = tripStopSequences.get(trip.trip_id);
    if (!stops || stops.length < 2) continue;

    const route = routesMap.get(trip.route_id);

    // For each pair of stops
    for (let i = 0; i < stops.length - 1; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const originPlatformId = stops[i].stopId;
        const destPlatformId = stops[j].stopId;

        const originStation = platformToStation.get(originPlatformId);
        const destStation = platformToStation.get(destPlatformId);

        if (!originStation || !destStation) continue;

        const stationData = perStationData.get(originStation);
        if (!stationData.routes.has(destStation)) {
          stationData.routes.set(destStation, {
            destination: stations.get(destStation),
            departures: []
          });
        }

        const originStop = stopsMap.get(originPlatformId);
        const destStop = stopsMap.get(destPlatformId);

        stationData.routes.get(destStation).departures.push({
          tripId: trip.trip_id,
          routeId: trip.route_id,
          routeName: route?.route_short_name || route?.route_long_name || 'Unknown',
          headsign: trip.trip_headsign || '',
          scheduledDeparture: stops[i].departure,
          scheduledArrival: stops[j].arrival,
          serviceId: trip.service_id,
          platform: originStop?.platform_code || null,
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

        departuresAdded++;
      }
    }

    tripsProcessed++;
    if (tripsProcessed % 100 === 0) {
      console.log(`  Processed ${tripsProcessed}/${trainData.trips.length} trips...`);
    }
  }

  // Convert to final structure
  const stationFiles = new Map();
  let totalRoutes = 0;

  for (const [stationName, stationData] of perStationData) {
    if (stationData.routes.size === 0) continue; // Skip stations with no departures

    const routes = {};
    for (const [destName, routeData] of stationData.routes) {
      const destSlug = stationSlugs.get(destName);
      routes[destSlug] = {
        destination: routeData.destination,
        departures: routeData.departures,
        totalDepartures: routeData.departures.length
      };
      totalRoutes++;
    }

    stationFiles.set(stationSlugs.get(stationName), {
      station: stationData.station,
      routes,
      totalRoutes: Object.keys(routes).length,
      generated: new Date().toISOString()
    });
  }

  console.log(`✅ Generated ${stationFiles.size} station files`);
  console.log(`   Total routes: ${totalRoutes}`);
  console.log(`   Total departures: ${departuresAdded}`);

  return stationFiles;
}

/**
 * Upload station files to Blob Storage
 */
async function uploadStationFiles(stationFiles) {
  console.log('☁️  Uploading to Vercel Blob Storage...');

  let uploaded = 0;
  let failed = 0;

  for (const [stationSlug, data] of stationFiles) {
    const filename = `train-station-${stationSlug}.json`;
    const content = JSON.stringify(data);

    try {
      await put(filename, content, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });

      uploaded++;
      if (uploaded % 10 === 0) {
        console.log(`  Uploaded ${uploaded}/${stationFiles.size} stations...`);
      }
    } catch (error) {
      console.error(`  ❌ Failed to upload ${filename}:`, error.message);
      failed++;
    }
  }

  console.log(`✅ Uploaded ${uploaded} station files`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed} files`);
  }

  return { uploaded, failed };
}

/**
 * Identify top stations by route count
 */
function identifyTopStations(stationFiles) {
  console.log('📊 Identifying top stations...');

  const sorted = Array.from(stationFiles.entries())
    .map(([slug, data]) => ({
      slug,
      station: data.station.name,
      routeCount: data.totalRoutes,
      totalDepartures: Object.values(data.routes).reduce((sum, r) => sum + r.totalDepartures, 0)
    }))
    .sort((a, b) => b.totalDepartures - a.totalDepartures)
    .slice(0, 20);

  console.log('\n🔥 Top 20 Stations by Departures:');
  sorted.forEach((station, i) => {
    console.log(`  ${i + 1}. ${station.station}: ${station.routeCount} routes, ${station.totalDepartures} departures`);
  });

  return sorted;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Train Schedule API Processor v4.0');
  console.log('📊 Per-Station Architecture');
  console.log('=======================================\n');

  try {
    const gtfsBuffer = await downloadGTFS();
    const gtfsData = await parseGTFSFiles(gtfsBuffer);
    const trainData = filterTrainData(gtfsData);
    const stationFiles = await generatePerStationFiles(trainData);
    const topStations = identifyTopStations(stationFiles);
    const { uploaded, failed } = await uploadStationFiles(stationFiles);

    // Generate metadata
    const metadata = {
      generated: new Date().toISOString(),
      version: '4.0',
      architecture: 'per-station',
      totalStations: stationFiles.size,
      uploaded,
      failed,
      topStations: topStations.map(s => ({
        slug: s.slug,
        station: s.station,
        routes: s.routeCount,
        departures: s.totalDepartures
      }))
    };

    await put('train-metadata-v4.json', JSON.stringify(metadata, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });

    console.log('\n✅ Process complete!');
    console.log(`   🚉 Stations: ${stationFiles.size}`);
    console.log(`   📤 Uploaded: ${uploaded}`);
    console.log(`   ❌ Failed: ${failed}`);

  } catch (error) {
    console.error('\n❌ Process failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generatePerStationFiles, uploadStationFiles };
