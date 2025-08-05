import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, isAfter, isBefore, addMinutes, startOfDay, addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Build ferry stop connectivity data
function buildStopConnectivity(trips, stopTimes, stops, routes) {
  console.log('Building stop connectivity data...');
  
  // Master list of ferry stop names
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
  
  // Filter for ferry stops only
  const ferryStopIds = new Set();
  const ferryStops = {};
  const stopConnectivity = {};
  
  // Get all ferry routes
  const ferryRoutes = routes.filter(route => route.route_id.startsWith('F'));
  const ferryRouteIds = new Set(ferryRoutes.map(r => r.route_id));
  
  // Get all trips for ferry routes
  const ferryTrips = trips.filter(trip => {
    // Only include ferry routes
    if (!trip.route_id.startsWith('F')) return false;
    
    return ferryRouteIds.has(trip.route_id) || 
      Array.from(ferryRouteIds).some(routeId => trip.route_id.startsWith(routeId));
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
  
  // Process each ferry trip to find stop patterns
  ferryTrips.forEach(trip => {
    const tripStopTimes = (stopTimesByTripMap.get(trip.trip_id) || [])
      .sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
    
    if (tripStopTimes.length === 0) return;
    
    // Extract stop sequence
    const stopSequence = tripStopTimes.map(st => st.stop_id);
    stopSequence.forEach(stopId => ferryStopIds.add(stopId));
    
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
  
  // Build ferry stops data with names and coordinates
  // Only include stops that match our master ferry stop list
  stops.forEach(stop => {
    if (ferryStopIds.has(stop.stop_id)) {
      // Check if this stop name contains any of our ferry stop names
      const stopNameLower = stop.stop_name.toLowerCase();
      const isFerryStop = FERRY_STOP_NAMES.some(ferryName => 
        stopNameLower.includes(ferryName.toLowerCase())
      ) && stopNameLower.includes('ferry');
      
      if (isFerryStop) {
        ferryStops[stop.stop_id] = {
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
  const ferryStopIdSet = new Set(Object.keys(ferryStops));
  Object.keys(ferryStops).forEach(stopId => {
    if (ferryStops[stopId].validDestinations) {
      ferryStops[stopId].validDestinations = ferryStops[stopId].validDestinations
        .filter(destId => ferryStopIdSet.has(destId));
    }
  });
  
  // Convert connectivity Sets to Arrays (only for ferry stops)
  const connectivityArray = {};
  Object.entries(stopConnectivity).forEach(([stopId, destinations]) => {
    if (ferryStopIdSet.has(stopId)) {
      connectivityArray[stopId] = Array.from(destinations)
        .filter(destId => ferryStopIdSet.has(destId))
        .sort();
    }
  });
  
  console.log(`Found ${Object.keys(ferryStops).length} ferry stops with connectivity data`);
  
  return {
    ferryStops,
    stopConnectivity: connectivityArray
  };
}

// Main processing function
async function processGTFSData() {
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

  // Process departures for next 48 hours
  const now = new Date();
  const nowZoned = toZonedTime(now, TIMEZONE);
  const todayStart = startOfDay(nowZoned);
  const endDate = addDays(todayStart, 2); // 48 hours
  
  console.log(`Processing departures from ${format(todayStart, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
  
  const activeServicesByDate = getActiveServiceIds(calendar, calendarDates, todayStart, endDate);
  
  const departures = [];
  // Process ALL ferry stops and routes
  const ferryStopIds = new Set();
  const ferryRouteIds = new Set();

  // Create a map of trip_id to stop times for faster lookup
  const stopTimesByTrip = new Map();
  stopTimes.forEach(st => {
    if (!stopTimesByTrip.has(st.trip_id)) {
      stopTimesByTrip.set(st.trip_id, []);
    }
    stopTimesByTrip.get(st.trip_id).push(st);
  });

  // First, identify all ferry routes and stops
  routes.forEach(route => {
    if (route.route_id.startsWith('F')) {
      ferryRouteIds.add(route.route_id);
    }
  });
  
  // Get all trips for ferry routes
  const relevantTrips = trips.filter(trip => {
    // Check if service is active on any day in our range
    const serviceActiveOnAnyDay = Array.from(activeServicesByDate.values())
      .some(services => services.includes(trip.service_id));
    
    if (!serviceActiveOnAnyDay) return false;
    
    // Include all ferry routes (starting with 'F')
    return trip.route_id.startsWith('F');
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
  const { ferryStops, stopConnectivity } = buildStopConnectivity(trips, stopTimes, stops, routes);
  
  // Create output
  const output = {
    generated: now.toISOString(),
    timezone: TIMEZONE,
    validFrom: nowZoned.toISOString(),
    validTo: endDate.toISOString(),
    departureCount: departures.length,
    departures: departures,
    ferryStops: ferryStops,
    stopConnectivity: stopConnectivity
  };
  
  // Save to file
  const outputDir = path.join(__dirname, '..', 'schedule-data');
  await fs.mkdir(outputDir, { recursive: true });
  
  const filename = `schedule-${format(nowZoned, 'yyyy-MM-dd')}.json`;
  const filepath = path.join(outputDir, filename);
  
  await fs.writeFile(filepath, JSON.stringify(output, null, 2));
  console.log(`Schedule saved to ${filepath}`);
  
  // Also save as latest.json for easy access
  const latestPath = path.join(outputDir, 'latest.json');
  await fs.writeFile(latestPath, JSON.stringify(output, null, 2));
  console.log(`Schedule also saved as latest.json`);
  
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