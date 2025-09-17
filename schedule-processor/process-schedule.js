import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, isAfter, isBefore, addMinutes, startOfDay, addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const mode = modeIndex !== -1 ? args[modeIndex + 1] : 'ferry';

console.log(`Processing schedule for mode: ${mode}`);

// Mode configurations
const MODE_CONFIGS = {
  ferry: {
    routeType: 4,
    routePrefix: 'F',
    outputDir: 'schedule-data/ferry',
  },
  train: {
    routeType: 2,
    routePrefix: null, // Trains don't have a consistent prefix
    outputDir: 'schedule-data/train',
  },
  bus: {
    routeType: 3,
    routePrefix: null, // Buses use numeric route IDs
    outputDir: 'schedule-data/bus',
  }
};

const modeConfig = MODE_CONFIGS[mode] || MODE_CONFIGS.ferry;

// Constants
const STOPS = {
  bulimba: "317584",
  riverside: "317590"
};

const ROUTES = {
  expressCityCat: "F11",
  allStopsCityCat: "F1"
};

const TIMEZONE = 'Australia/Brisbane';

// Parse CSV content
function parseCSV(content) {
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true
  });
  return result.data;
}

// Get active service IDs for given dates
function getActiveServiceIds(calendar, calendarDates, startDate, endDate) {
  const activeServicesByDate = new Map();
  
  // Process each day in range
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayOfWeek = format(currentDate, 'EEEE').toLowerCase();
    const dateStr = format(currentDate, 'yyyyMMdd');
    const activeServices = [];

    // Check regular calendar
    calendar.forEach(service => {
      const serviceStart = parse(service.start_date, 'yyyyMMdd', new Date());
      const serviceEnd = parse(service.end_date, 'yyyyMMdd', new Date());
      
      if ((isAfter(currentDate, serviceStart) || currentDate.getTime() === serviceStart.getTime()) && 
          (isBefore(currentDate, serviceEnd) || currentDate.getTime() === serviceEnd.getTime()) && 
          service[dayOfWeek] === '1') {
        activeServices.push(service.service_id);
      }
    });

    // Check calendar dates for exceptions
    calendarDates.forEach(exception => {
      if (exception.date === dateStr) {
        if (exception.exception_type === '1') {
          // Service added for this date
          activeServices.push(exception.service_id);
        } else if (exception.exception_type === '2') {
          // Service removed for this date
          const index = activeServices.indexOf(exception.service_id);
          if (index > -1) {
            activeServices.splice(index, 1);
          }
        }
      }
    });

    activeServicesByDate.set(dateStr, [...new Set(activeServices)]);
    currentDate = addDays(currentDate, 1);
  }
  
  return activeServicesByDate;
}

// Determine direction based on stop sequence
function determineDirection(currentStopId, allStopTimes, currentIndex, trip) {
  // Try to use headsign first
  if (trip.trip_headsign) {
    const headsign = trip.trip_headsign.toLowerCase();
    if (headsign.includes('riverside')) {
      return 'outbound';
    } else if (headsign.includes('bulimba')) {
      return 'inbound';
    }
  }

  // Fall back to checking stop sequence
  const hasRiversideAfter = allStopTimes.slice(currentIndex + 1).some(st => 
    st.stop_id === STOPS.riverside
  );
  const hasBulimbaAfter = allStopTimes.slice(currentIndex + 1).some(st => 
    st.stop_id === STOPS.bulimba
  );
  
  if (currentStopId === STOPS.bulimba && hasRiversideAfter) {
    return 'outbound';
  } else if (currentStopId === STOPS.riverside && hasBulimbaAfter) {
    return 'inbound';
  }
  
  return currentStopId === STOPS.bulimba ? 'outbound' : 'inbound';
}

// Build mode stop connectivity data
function buildStopConnectivity(trips, stopTimes, stops, modeRouteIds) {
  console.log(`Building ${mode} stop connectivity data...`);

  // Master list of ferry stop names (only used for ferry mode)
  const FERRY_STOP_NAMES = [
    'Apollo Road',
    'Bretts Wharf',
    'Bulimba',
    'Dockside',
    'Guyatt Park',
    'Hawthorne',
    'Holman Street',
    'Howard Smith Wharves',
    'Maritime Museum',
    'Milton',
    'Mowbray Park',
    'New Farm Park',
    'North Quay',
    'Northshore Hamilton',
    'QUT Gardens Point',
    'Regatta',
    'Riverside',
    'South Bank',
    'Sydney Street',
    'Teneriffe',
    'UQ St Lucia',
    'West End'
  ];
  
  // Filter for mode stops only
  const modeStopIdsSet = new Set();
  // Filter for mode-specific stops only
  const modeStopIds = new Set();
  const modeStops = {};
  const stopConnectivity = {};

  // Generate route allow-set for filtering
  const routeAllowSet = Array.from(modeRouteIds);
  console.log(`Found ${routeAllowSet.length} ${mode} routes:`, routeAllowSet.slice(0, 10), '...');

  // Get all trips for mode routes
  const modeTrips = trips.filter(trip => {
    return modeRouteIds.has(trip.route_id);
  });
  
  // Create a map of trip patterns (unique stop sequences)
  const tripPatterns = new Map(); // key: route_id-direction_id, value: Set of stop sequences
  
  // Create stopTimesByTrip map for efficiency
  const stopTimesByTripMap = new Map();
  stopTimes.forEach(st => {
    if (!stopTimesByTripMap.has(st.trip_id)) {
      stopTimesByTripMap.set(st.trip_id, []);
    }
    stopTimesByTripMap.get(st.trip_id).push(st);
  });
  
  // Process each mode trip to find stop patterns
  modeTrips.forEach(trip => {
    const tripStopTimes = (stopTimesByTripMap.get(trip.trip_id) || [])
      .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
    
    if (tripStopTimes.length === 0) return;
    
    // Extract stop sequence
    const stopSequence = tripStopTimes.map(st => st.stop_id);
    stopSequence.forEach(stopId => modeStopIdsSet.add(stopId));
    
    // Store pattern by route and direction
    const patternKey = `${trip.route_id}-${trip.direction_id || '0'}`;
    if (!tripPatterns.has(patternKey)) {
      tripPatterns.set(patternKey, new Set());
    }
    
    // Store as JSON string to handle array comparison in Set
    tripPatterns.get(patternKey).add(JSON.stringify(stopSequence));
  });
  
  // Build connectivity map from patterns
  tripPatterns.forEach((patterns, routeKey) => {
    patterns.forEach(patternJson => {
      const stopSequence = JSON.parse(patternJson);
      
      // For each stop in the sequence, add all subsequent stops as destinations
      stopSequence.forEach((originStop, originIndex) => {
        if (!stopConnectivity[originStop]) {
          stopConnectivity[originStop] = new Set();
        }
        
        // Add all stops after this one as valid destinations
        for (let i = originIndex + 1; i < stopSequence.length; i++) {
          stopConnectivity[originStop].add(stopSequence[i]);
        }
      });
    });
  });
  
  // Build mode stops data with names and coordinates
  stops.forEach(stop => {
    if (modeStopIdsSet.has(stop.stop_id)) {
      const stopNameLower = stop.stop_name.toLowerCase();

      // Mode-specific filtering
      let includeStop = false;

      if (mode === 'ferry') {
        // For ferry mode, only include ferry stops
        const isFerryStop = FERRY_STOP_NAMES.some(ferryName =>
          stopNameLower.includes(ferryName.toLowerCase())
        ) && stopNameLower.includes('ferry');
        includeStop = isFerryStop;
      } else if (mode === 'train') {
        // For train mode, include stops with IDs starting with 600 (train stations)
        includeStop = stop.stop_id.startsWith('600');
      } else if (mode === 'bus') {
        // For bus mode, include all stops that aren't ferry or train
        includeStop = !stopNameLower.includes('ferry') && !stop.stop_id.startsWith('600');
      } else {
        // Default: include all stops for unknown modes
        includeStop = true;
      }

      if (includeStop) {
        modeStops[stop.stop_id] = {
          name: stop.stop_name,
          lat: parseFloat(stop.stop_lat),
          lng: parseFloat(stop.stop_lon),
          validDestinations: stopConnectivity[stop.stop_id]
            ? Array.from(stopConnectivity[stop.stop_id]).sort()
            : []
        };
      }
    }
  });
  
  // Filter connectivity to only include ferry stops
  const modeStopIdSet = new Set(Object.keys(modeStops));
  Object.keys(modeStops).forEach(stopId => {
    if (modeStops[stopId].validDestinations) {
      modeStops[stopId].validDestinations = modeStops[stopId].validDestinations
        .filter(destId => modeStopIdSet.has(destId));
    }
  });
  
  // Convert connectivity Sets to Arrays (only for mode stops)
  const connectivityArray = {};
  Object.entries(stopConnectivity).forEach(([stopId, destinations]) => {
    if (modeStopIdSet.has(stopId)) {
      connectivityArray[stopId] = Array.from(destinations)
        .filter(destId => modeStopIdSet.has(destId))
        .sort();
    }
  });

  console.log(`Found ${Object.keys(modeStops).length} ${mode} stops with connectivity data`);

  return {
    modeStops,
    stopConnectivity: connectivityArray,
    routeAllowSet
  };
}

// Main processing function
async function processGTFSData() {
  // Get mode routes first to use throughout processing
  let modeRouteIds = new Set();
  console.log('Fetching GTFS data...');
  
  // Fetch the GTFS ZIP file
  const gtfsUrl = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
  const response = await fetch(gtfsUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch GTFS data: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  console.log('Parsing GTFS files...');

  // Parse required files
  const routes = parseCSV(await zip.file('routes.txt').async('string'));
  const trips = parseCSV(await zip.file('trips.txt').async('string'));
  const stopTimes = parseCSV(await zip.file('stop_times.txt').async('string'));
  const calendar = parseCSV(await zip.file('calendar.txt').async('string'));
  const calendarDates = parseCSV(await zip.file('calendar_dates.txt').async('string'));
  const stops = parseCSV(await zip.file('stops.txt').async('string'));

  // Get mode-specific routes
  const modeRoutes = routes.filter(route => {
    // Filter by route_type
    if (route.route_type !== undefined && route.route_type !== null) {
      return parseInt(route.route_type) === modeConfig.routeType;
    }
    // Fallback to prefix filtering for ferry
    if (mode === 'ferry') {
      return route.route_id.startsWith('F');
    }
    return false;
  });
  modeRouteIds = new Set(modeRoutes.map(r => r.route_id));
  console.log(`Found ${modeRouteIds.size} ${mode} routes`);

  // Process departures for next 48 hours
  const now = new Date();
  const nowZoned = toZonedTime(now, TIMEZONE);
  const todayStart = startOfDay(nowZoned);
  const endDate = addDays(todayStart, 2); // 48 hours
  
  console.log(`Processing departures from ${format(todayStart, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
  
  const activeServicesByDate = getActiveServiceIds(calendar, calendarDates, todayStart, endDate);
  
  const departures = [];
  // Process ALL mode stops and routes
  const modeStopIds = new Set();
  const modeRouteIdsSet = new Set();

  // Create a map of trip_id to stop times for faster lookup
  const stopTimesByTrip = new Map();
  stopTimes.forEach(st => {
    if (!stopTimesByTrip.has(st.trip_id)) {
      stopTimesByTrip.set(st.trip_id, []);
    }
    stopTimesByTrip.get(st.trip_id).push(st);
  });

  // First, identify all mode routes and stops based on route type
  routes.forEach(route => {
    // Filter by route type and optional prefix
    const matchesType = parseInt(route.route_type) === modeConfig.routeType;
    const matchesPrefix = !modeConfig.routePrefix || route.route_id.startsWith(modeConfig.routePrefix);
    if (matchesType && matchesPrefix) {
      modeRouteIdsSet.add(route.route_id);
    }
  });
  
  // Get all trips for mode routes
  const relevantTrips = trips.filter(trip => {
    // Check if service is active on any day in our range
    const serviceActiveOnAnyDay = Array.from(activeServicesByDate.values())
      .some(services => services.includes(trip.service_id));

    if (!serviceActiveOnAnyDay) return false;

    // Filter by route allow-set
    return modeRouteIds.has(trip.route_id);
  });

  console.log(`Found ${relevantTrips.length} relevant trips`);

  // Process stop times for relevant trips
  relevantTrips.forEach(trip => {
    const tripStopTimes = stopTimesByTrip.get(trip.trip_id) || [];
    
    tripStopTimes.forEach((stopTime, index) => {
      // Include all stops (we'll filter for ferry terminals later)

      // Parse departure time for each day the service runs
      activeServicesByDate.forEach((services, dateStr) => {
        if (!services.includes(trip.service_id)) return;
        
        const baseDate = parse(dateStr, 'yyyyMMdd', new Date());
        const timeParts = stopTime.departure_time.split(':');
        let hours = parseInt(timeParts[0]);
        const minutes = parseInt(timeParts[1]);
        
        // Handle times after midnight
        let departureDate = new Date(baseDate);
        if (hours >= 24) {
          hours -= 24;
          departureDate.setDate(departureDate.getDate() + 1);
        }
        
        // Set the time (this creates a date in local timezone, which we'll treat as Brisbane time)
        departureDate.setHours(hours, minutes, 0, 0);
        
        // Convert from Brisbane time to UTC for storage
        // fromZonedTime treats the input date as if it's in the specified timezone
        const departureUTC = fromZonedTime(departureDate, TIMEZONE);
        
        // For filtering, we need the Brisbane time
        const departureZoned = toZonedTime(departureUTC, TIMEZONE);

        // Include all departures for the day (from midnight to end of period)
        if (departureZoned >= todayStart && departureZoned <= endDate) {
          // For schedule data, include all ferry stops (no specific direction filtering)
          // The client will filter based on selected stops
          const direction = 'outbound'; // Generic direction for schedule data
          
          departures.push({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            serviceId: trip.service_id,
            departureTime: departureUTC.toISOString(),
            stopId: stopTime.stop_id,
            direction: direction,
            headsign: trip.trip_headsign,
            isScheduled: true,
            stopSequence: parseInt(stopTime.stop_sequence)
          });
        }
      });
    });
  });

  // Sort by departure time
  departures.sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
  
  console.log(`Processed ${departures.length} scheduled departures`);
  
  // Build stop connectivity data
  const { modeStops, stopConnectivity, routeAllowSet } = buildStopConnectivity(trips, stopTimes, stops, modeRouteIds);

  // Create output
  const output = {
    generated: now.toISOString(),
    mode: mode,
    routeType: modeConfig.routeType,
    routeAllowSet: routeAllowSet,
    timezone: TIMEZONE,
    validFrom: nowZoned.toISOString(),
    validTo: endDate.toISOString(),
    departureCount: departures.length,
    departures: departures,
    stops: modeStops, // Use 'stops' for consistency across modes
    stopConnectivity: stopConnectivity
  };

  // Save to mode-specific directory
  const outputDir = path.join(__dirname, '..', modeConfig.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const filename = `schedule-${format(nowZoned, 'yyyy-MM-dd')}.json`;
  const filepath = path.join(outputDir, filename);

  await fs.writeFile(filepath, JSON.stringify(output, null, 2));
  console.log(`${mode} schedule saved to ${filepath}`);

  // Also save as latest.json for easy access
  const latestPath = path.join(outputDir, 'latest.json');
  await fs.writeFile(latestPath, JSON.stringify(output, null, 2));
  console.log(`${mode} schedule also saved as latest.json`);

  // For backward compatibility, also save ferry data to root schedule-data
  if (mode === 'ferry') {
    const rootOutputDir = path.join(__dirname, '..', 'schedule-data');
    await fs.mkdir(rootOutputDir, { recursive: true });
    const rootLatestPath = path.join(rootOutputDir, 'latest.json');
    await fs.writeFile(rootLatestPath, JSON.stringify(output, null, 2));
    console.log('Ferry schedule also saved to root schedule-data for backward compatibility');
  }
  
  return output;
}

// Run the processor
processGTFSData()
  .then(() => {
    console.log('Processing complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error processing GTFS data:', error);
    process.exit(1);
  });