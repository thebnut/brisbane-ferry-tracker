import JSZip from 'jszip';
import Papa from 'papaparse';
import { format, parse, isAfter, isBefore, addMinutes, startOfDay, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
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

  // Process departures for next 48 hours
  const now = new Date();
  const nowZoned = toZonedTime(now, TIMEZONE);
  const todayStart = startOfDay(nowZoned);
  const endDate = addDays(todayStart, 2); // 48 hours
  
  console.log(`Processing departures from ${format(todayStart, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`);
  
  const activeServicesByDate = getActiveServiceIds(calendar, calendarDates, todayStart, endDate);
  
  const departures = [];
  const relevantStopIds = [STOPS.bulimba, STOPS.riverside];
  const relevantRouteIds = [ROUTES.expressCityCat, ROUTES.allStopsCityCat];

  // Create a map of trip_id to stop times for faster lookup
  const stopTimesByTrip = new Map();
  stopTimes.forEach(st => {
    if (!stopTimesByTrip.has(st.trip_id)) {
      stopTimesByTrip.set(st.trip_id, []);
    }
    stopTimesByTrip.get(st.trip_id).push(st);
  });

  // Get relevant trips
  const relevantTrips = trips.filter(trip => {
    // Check if service is active on any day in our range
    const serviceActiveOnAnyDay = Array.from(activeServicesByDate.values())
      .some(services => services.includes(trip.service_id));
    
    if (!serviceActiveOnAnyDay) return false;
    if (!relevantRouteIds.some(routeId => trip.route_id === routeId || trip.route_id.startsWith(routeId))) return false;
    
    // Check if this trip has both Bulimba and Riverside stops
    const tripStopTimes = stopTimesByTrip.get(trip.trip_id) || [];
    const hasBulimba = tripStopTimes.some(st => st.stop_id === STOPS.bulimba);
    const hasRiverside = tripStopTimes.some(st => st.stop_id === STOPS.riverside);
    
    return hasBulimba && hasRiverside;
  });

  console.log(`Found ${relevantTrips.length} relevant trips`);

  // Process stop times for relevant trips
  relevantTrips.forEach(trip => {
    const tripStopTimes = stopTimesByTrip.get(trip.trip_id) || [];
    
    tripStopTimes.forEach((stopTime, index) => {
      if (!relevantStopIds.includes(stopTime.stop_id)) {
        return;
      }

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
        
        departureDate.setHours(hours, minutes, 0, 0);
        const departureZoned = toZonedTime(departureDate, TIMEZONE);

        // Only include departures within our time window
        if (departureZoned >= nowZoned && departureZoned <= endDate) {
          // Check if this departure goes to the other terminal
          const remainingStops = tripStopTimes.slice(index + 1);
          let goesToOtherTerminal = false;
          
          if (stopTime.stop_id === STOPS.bulimba) {
            goesToOtherTerminal = remainingStops.some(st => st.stop_id === STOPS.riverside);
          } else if (stopTime.stop_id === STOPS.riverside) {
            goesToOtherTerminal = remainingStops.some(st => st.stop_id === STOPS.bulimba);
          }
          
          if (!goesToOtherTerminal) {
            return;
          }
          
          const direction = determineDirection(stopTime.stop_id, tripStopTimes, index, trip);
          
          departures.push({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            serviceId: trip.service_id,
            departureTime: departureDate.toISOString(),
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
  
  // Create output
  const output = {
    generated: now.toISOString(),
    timezone: TIMEZONE,
    validFrom: nowZoned.toISOString(),
    validTo: endDate.toISOString(),
    departureCount: departures.length,
    departures: departures
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