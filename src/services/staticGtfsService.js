import JSZip from 'jszip';
import Papa from 'papaparse';
import { STOPS, ROUTES, DEBUG_CONFIG } from '../utils/constants';
import { startOfDay, endOfDay, format, parse, isAfter, isBefore, addMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

class StaticGTFSService {
  constructor() {
    this.timezone = 'Australia/Brisbane';
    this.scheduleCacheKey = 'brisbane-ferry-schedule-cache';
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.gtfsData = null;
    this.debug = DEBUG_CONFIG.enableLogging;
  }

  // Debug logging helper
  log(...args) {
    if (this.debug) console.log(...args);
  }

  // Check if we have valid cached schedule data
  getCachedSchedule() {
    try {
      const cached = localStorage.getItem(this.scheduleCacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < this.cacheExpiry) {
          this.log('Using cached ferry schedule');
          // Filter out past departures from cache and convert dates
          const now = new Date();
          return data.departures
            .map(dep => ({
              ...dep,
              departureTime: new Date(dep.departureTime) // Convert string back to Date
            }))
            .filter(dep => dep.departureTime > now);
        }
      }
    } catch (error) {
      console.error('Error reading schedule cache:', error);
    }
    return null;
  }

  // Save processed schedule data to cache
  setCachedSchedule(departures) {
    try {
      localStorage.setItem(this.scheduleCacheKey, JSON.stringify({
        timestamp: Date.now(),
        departures: departures
      }));
      this.log('Cached ferry schedule successfully');
    } catch (error) {
      console.error('Error saving schedule cache:', error);
    }
  }

  // Fetch and parse GTFS ZIP file (no longer caches raw data)
  async fetchGTFSData() {
    try {
      // Use proxy in development or Vercel
      const url = import.meta.env.DEV || window.location.hostname.includes('vercel') 
        ? '/api/gtfs-static'
        : 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
      
      this.log('Fetching static GTFS data...');
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch GTFS data: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      // Parse the files we need
      const data = {
        routes: await this.parseCSVFile(zip, 'routes.txt'),
        trips: await this.parseCSVFile(zip, 'trips.txt'),
        stopTimes: await this.parseCSVFile(zip, 'stop_times.txt'),
        calendar: await this.parseCSVFile(zip, 'calendar.txt'),
        calendarDates: await this.parseCSVFile(zip, 'calendar_dates.txt')
      };

      this.gtfsData = data;
      // Don't cache raw GTFS data - too large for localStorage
      
      this.log('GTFS data loaded successfully');
      return data;
    } catch (error) {
      console.error('Error fetching GTFS data:', error);
      // Return empty data structure if fetch fails
      return {
        routes: [],
        trips: [],
        stopTimes: [],
        calendar: [],
        calendarDates: []
      };
    }
  }

  // Parse CSV file from ZIP
  async parseCSVFile(zip, filename) {
    const file = zip.file(filename);
    if (!file) {
      if (this.debug) console.warn(`File ${filename} not found in GTFS ZIP`);
      return [];
    }

    const content = await file.async('string');
    const result = Papa.parse(content, {
      header: true,
      skipEmptyLines: true
    });

    if (result.errors.length > 0) {
      if (this.debug) console.warn(`Errors parsing ${filename}:`, result.errors);
    }

    return result.data;
  }

  // Get service IDs that are active today
  getActiveServiceIds(date = new Date()) {
    if (!this.gtfsData) return [];

    const dayOfWeek = format(date, 'EEEE').toLowerCase();
    const dateStr = format(date, 'yyyyMMdd');
    
    const activeServices = [];

    // Check regular calendar
    this.gtfsData.calendar.forEach(service => {
      const startDate = parse(service.start_date, 'yyyyMMdd', new Date());
      const endDate = parse(service.end_date, 'yyyyMMdd', new Date());
      
      if (isAfter(date, startDate) && isBefore(date, endDate) && service[dayOfWeek] === '1') {
        activeServices.push(service.service_id);
      }
    });

    // Check calendar dates for exceptions
    this.gtfsData.calendarDates.forEach(exception => {
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

    return [...new Set(activeServices)]; // Remove duplicates
  }

  // Get scheduled departures for our ferry routes
  async getScheduledDepartures() {
    // Check cache first
    const cachedSchedule = this.getCachedSchedule();
    if (cachedSchedule && cachedSchedule.length > 0) {
      return cachedSchedule;
    }

    // If no cache, fetch GTFS data
    if (!this.gtfsData) {
      await this.fetchGTFSData();
    }

    if (!this.gtfsData || !this.gtfsData.stopTimes) {
      return [];
    }

    const now = new Date();
    const nowZoned = toZonedTime(now, this.timezone);
    const todayStart = startOfDay(nowZoned);
    const activeServices = this.getActiveServiceIds(nowZoned);
    
    const departures = [];
    const relevantStopIds = [STOPS.bulimba, STOPS.riverside];
    const relevantRouteIds = [ROUTES.expressCityCat, ROUTES.allStopsCityCat];

    // Get relevant trips - but we need to check if they go between our terminals
    const relevantTrips = this.gtfsData.trips.filter(trip => {
      if (!activeServices.includes(trip.service_id)) return false;
      if (!relevantRouteIds.some(routeId => trip.route_id === routeId || trip.route_id.startsWith(routeId))) return false;
      
      // Check if this trip has both Bulimba and Riverside stops
      const tripStopTimes = this.gtfsData.stopTimes.filter(st => st.trip_id === trip.trip_id);
      const hasBulimba = tripStopTimes.some(st => st.stop_id === STOPS.bulimba);
      const hasRiverside = tripStopTimes.some(st => st.stop_id === STOPS.riverside);
      
      return hasBulimba && hasRiverside;
    });

    // Process stop times for relevant trips
    relevantTrips.forEach(trip => {
      const tripStopTimes = this.gtfsData.stopTimes.filter(st => st.trip_id === trip.trip_id);
      
      tripStopTimes.forEach((stopTime, index) => {
        if (!relevantStopIds.includes(stopTime.stop_id)) {
          return;
        }

        // Parse departure time (GTFS format: HH:MM:SS, can be > 24:00 for next day)
        const timeParts = stopTime.departure_time.split(':');
        let hours = parseInt(timeParts[0]);
        const minutes = parseInt(timeParts[1]);
        
        // Handle times after midnight (e.g., 25:30:00 = 1:30 AM next day)
        let departureDate = new Date(todayStart);
        if (hours >= 24) {
          hours -= 24;
          departureDate.setDate(departureDate.getDate() + 1);
        }
        
        departureDate.setHours(hours, minutes, 0, 0);
        const departureZoned = toZonedTime(departureDate, this.timezone);

        // Only include future departures within 24 hours
        if (departureZoned > nowZoned && departureZoned < addMinutes(nowZoned, 24 * 60)) {
          // Check if this departure goes to the other terminal
          const remainingStops = tripStopTimes.slice(index + 1);
          let goesToOtherTerminal = false;
          
          if (stopTime.stop_id === STOPS.bulimba) {
            // For Bulimba → Riverside: Check if Riverside appears later
            goesToOtherTerminal = remainingStops.some(st => st.stop_id === STOPS.riverside);
          } else if (stopTime.stop_id === STOPS.riverside) {
            // For Riverside → Bulimba: Check if Bulimba appears later
            goesToOtherTerminal = remainingStops.some(st => st.stop_id === STOPS.bulimba);
          }
          
          if (!goesToOtherTerminal) {
            return; // Skip this departure
          }
          
          // Determine direction based on stop sequence
          const direction = this.determineDirection(stopTime.stop_id, tripStopTimes, index, trip);
          
          departures.push({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            serviceId: trip.service_id,
            departureTime: departureDate,
            stopId: stopTime.stop_id,
            direction: direction,
            headsign: trip.trip_headsign,
            isScheduled: true, // Mark as scheduled, not real-time
            stopSequence: parseInt(stopTime.stop_sequence)
          });
        }
      });
    });

    // Sort by departure time
    departures.sort((a, b) => a.departureTime - b.departureTime);
    
    this.log(`Found ${departures.length} scheduled departures`);
    
    // Cache the scheduled departures
    if (departures.length > 0) {
      this.setCachedSchedule(departures);
    }
    
    return departures;
  }

  // Determine direction based on trip headsign or stop sequence
  determineDirection(currentStopId, allStopTimes, currentIndex, trip) {
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
    
    // Default based on current stop
    return currentStopId === STOPS.bulimba ? 'outbound' : 'inbound';
  }
}

export default new StaticGTFSService();