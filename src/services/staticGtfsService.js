import JSZip from 'jszip';
import Papa from 'papaparse';
import { STOPS, ROUTES, DEBUG_CONFIG, STORAGE_KEYS } from '../utils/constants';
import { startOfDay, endOfDay, format, parse, isAfter, isBefore, addMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

class StaticGTFSService {
  constructor() {
    this.timezone = 'Australia/Brisbane';
    this.scheduleCacheKey = STORAGE_KEYS.SCHEDULE_CACHE;
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.gtfsData = null;
    this.ferryStops = null;
    this.stopConnectivity = null;
    this.debug = DEBUG_CONFIG.enableLogging;
    
    // URL parameter support: Add ?useGitHub=true to use GitHub data on localhost
    // This helps developers test with the latest production data
    const urlParams = new URLSearchParams(window.location.search);
    const forceGitHub = urlParams.get('useGitHub') || urlParams.get('useGithub');
    
    // GitHub Pages URL for pre-processed schedule data
    this.githubScheduleUrl = (window.location.hostname === 'localhost' && !forceGitHub)
      ? '/schedule-data/latest.json'
      : 'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/latest.json';
    
    // Log the data source for debugging on localhost
    if (window.location.hostname === 'localhost') {
      console.log(`Using ${forceGitHub ? 'GitHub' : 'local'} schedule data on localhost`);
    }
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
              departureTime: new Date(dep.departureTime), // Convert string back to Date
              destinationArrivalTime: dep.destinationArrivalTime ? new Date(dep.destinationArrivalTime) : null // Convert arrival time if exists
            }))
            .filter(dep => dep.departureTime > now);
        }
      }
    } catch (error) {
      console.error('Error reading schedule cache:', error);
    }
    return null;
  }

  // Check if cached data has a generated timestamp
  getCachedGeneratedTime() {
    try {
      const cached = localStorage.getItem(this.scheduleCacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        if (cachedData.generated) {
          return new Date(cachedData.generated).getTime();
        }
      }
    } catch (error) {
      this.log('Error reading cached generated time:', error.message);
    }
    return null;
  }

  // Save processed schedule data to cache
  setCachedSchedule(departures, generated = null) {
    try {
      localStorage.setItem(this.scheduleCacheKey, JSON.stringify({
        timestamp: Date.now(),
        generated: generated || new Date().toISOString(),
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


  // Try to fetch pre-processed schedule from GitHub
  async fetchGitHubSchedule() {
    try {
      this.log('Fetching pre-processed schedule from GitHub...');
      const response = await fetch(this.githubScheduleUrl);
      
      if (!response.ok) {
        throw new Error(`GitHub schedule fetch failed: ${response.status}`);
      }
      
      const data = await response.json();
      this.log(`Received ${data.departureCount} departures from GitHub`);
      
      // Store ferry stops and connectivity data if available
      if (data.ferryStops) {
        this.ferryStops = data.ferryStops;
        this.log(`Loaded ${Object.keys(data.ferryStops).length} ferry stops`);
      }
      
      if (data.stopConnectivity) {
        this.stopConnectivity = data.stopConnectivity;
        this.log('Loaded stop connectivity data');
      }
      
      // Convert departure times to Date objects and filter to next 24 hours
      const now = new Date();
      const cutoffTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      const allDepartures = data.departures
        .map(dep => ({
          ...dep,
          departureTime: new Date(dep.departureTime),
          destinationArrivalTime: dep.destinationArrivalTime ? new Date(dep.destinationArrivalTime) : null // Convert arrival time if exists
        }))
        .filter(dep => dep.departureTime > now && dep.departureTime < cutoffTime);
      
      // Return both departures and generated timestamp
      return {
        departures: allDepartures,
        generated: data.generated,
        allDepartures: allDepartures // Keep reference to all departures for arrival time calculation
      };
    } catch (error) {
      this.log('GitHub schedule fetch failed:', error.message);
      return null;
    }
  }

  // Process GitHub departures to calculate arrival times and filter for selected stops
  processGitHubDepartures(allDepartures, selectedStops) {
    if (!selectedStops) {
      selectedStops = { 
        outbound: { id: STOPS.bulimba, name: 'Bulimba' }, 
        inbound: { id: STOPS.riverside, name: 'Riverside' } 
      };
    }
    
    const relevantStopIds = [selectedStops.outbound.id, selectedStops.inbound.id];
    const relevantRouteIds = [ROUTES.expressCityCat, ROUTES.allStopsCityCat];
    
    // Group departures by tripId for efficient lookup
    const departuresByTrip = new Map();
    allDepartures.forEach(dep => {
      if (!departuresByTrip.has(dep.tripId)) {
        departuresByTrip.set(dep.tripId, []);
      }
      departuresByTrip.get(dep.tripId).push(dep);
    });
    
    // Process departures from selected stops
    const processedDepartures = [];
    
    allDepartures.forEach(dep => {
      // Only process departures from selected stops on ferry routes
      if (!relevantStopIds.includes(dep.stopId)) return;
      if (!relevantRouteIds.some(routeId => dep.routeId === routeId || dep.routeId.startsWith(routeId))) return;
      
      // Get all stops for this trip
      const tripStops = departuresByTrip.get(dep.tripId) || [];
      
      // Sort by stop sequence
      tripStops.sort((a, b) => a.stopSequence - b.stopSequence);
      
      // Find current stop index
      const currentIndex = tripStops.findIndex(s => s.stopId === dep.stopId && s.stopSequence === dep.stopSequence);
      if (currentIndex === -1) return;
      
      // Check if trip goes to the other terminal
      const remainingStops = tripStops.slice(currentIndex + 1);
      const destinationStopId = dep.stopId === selectedStops.outbound.id 
        ? selectedStops.inbound.id 
        : selectedStops.outbound.id;
      
      const destinationStop = remainingStops.find(s => s.stopId === destinationStopId);
      if (!destinationStop) return; // Trip doesn't go to the other terminal
      
      // Calculate arrival time from destination stop's departure time
      const destinationArrivalTime = new Date(destinationStop.departureTime);
      
      // Determine direction
      const direction = dep.stopId === selectedStops.outbound.id ? 'outbound' : 'inbound';
      
      if (this.debug) {
        console.log(`GitHub departure: Trip ${dep.tripId} from ${dep.stopId} to ${destinationStopId}, arrival: ${destinationArrivalTime.toISOString()}`);
      }
      
      processedDepartures.push({
        ...dep,
        destinationArrivalTime,
        direction
      });
    });
    
    this.log(`Processed ${processedDepartures.length} departures from GitHub data for selected stops`);
    return processedDepartures;
  }

  // Get scheduled departures for our ferry routes
  async getScheduledDepartures(selectedStops = null) {
    // Get cached generated time if available
    const cachedGeneratedTime = this.getCachedGeneratedTime();
    
    // Always try to fetch from GitHub first to check if there's newer data
    const githubResult = await this.fetchGitHubSchedule();
    
    if (githubResult && githubResult.departures && githubResult.departures.length > 0) {
      // Compare generated timestamps if we have cached data
      if (cachedGeneratedTime) {
        const githubGeneratedTime = new Date(githubResult.generated).getTime();
        
        if (githubGeneratedTime > cachedGeneratedTime) {
          this.log(`GitHub has newer data (${githubResult.generated} > cached), updating cache`);
          const processedDepartures = this.processGitHubDepartures(githubResult.allDepartures || githubResult.departures, selectedStops);
          this.setCachedSchedule(processedDepartures, githubResult.generated);
          return processedDepartures;
        } else {
          this.log('Cache is up to date, processing cached data for selected stops');
          // Need to process GitHub data even when using cache
          const processedDepartures = this.processGitHubDepartures(githubResult.allDepartures || githubResult.departures, selectedStops);
          return processedDepartures;
        }
      } else {
        // No cached generated time, save the new data
        this.log('No cached generated timestamp, saving GitHub data');
        const processedDepartures = this.processGitHubDepartures(githubResult.allDepartures || githubResult.departures, selectedStops);
        this.setCachedSchedule(processedDepartures, githubResult.generated);
        return processedDepartures;
      }
    }
    
    // If GitHub fetch failed, try cache
    const cachedSchedule = this.getCachedSchedule();
    if (cachedSchedule && cachedSchedule.length > 0) {
      this.log('GitHub fetch failed, using cached data');
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
    // Use selectedStops if provided, otherwise fall back to default
    const stops = selectedStops || { 
      outbound: { id: STOPS.bulimba, name: 'Bulimba' }, 
      inbound: { id: STOPS.riverside, name: 'Riverside' } 
    };
    const relevantStopIds = [stops.outbound.id, stops.inbound.id];
    const relevantRouteIds = [ROUTES.expressCityCat, ROUTES.allStopsCityCat];

    // Get relevant trips - but we need to check if they go between our terminals
    const relevantTrips = this.gtfsData.trips.filter(trip => {
      if (!activeServices.includes(trip.service_id)) return false;
      if (!relevantRouteIds.some(routeId => trip.route_id === routeId || trip.route_id.startsWith(routeId))) return false;
      
      // Check if this trip has both selected stops
      const tripStopTimes = this.gtfsData.stopTimes.filter(st => st.trip_id === trip.trip_id);
      const hasOutboundStop = tripStopTimes.some(st => st.stop_id === stops.outbound.id);
      const hasInboundStop = tripStopTimes.some(st => st.stop_id === stops.inbound.id);
      
      return hasOutboundStop && hasInboundStop;
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
        // Convert from Brisbane time to UTC for storage
        const departureUTC = fromZonedTime(departureDate, this.timezone);
        const departureZoned = toZonedTime(departureUTC, this.timezone);

        // Only include future departures within 24 hours
        if (departureZoned > nowZoned && departureZoned < addMinutes(nowZoned, 24 * 60)) {
          // Check if this departure goes to the other terminal
          const remainingStops = tripStopTimes.slice(index + 1);
          let goesToOtherTerminal = false;
          
          if (stopTime.stop_id === stops.outbound.id) {
            // For outbound → inbound: Check if inbound appears later
            goesToOtherTerminal = remainingStops.some(st => st.stop_id === stops.inbound.id);
          } else if (stopTime.stop_id === stops.inbound.id) {
            // For inbound → outbound: Check if outbound appears later
            goesToOtherTerminal = remainingStops.some(st => st.stop_id === stops.outbound.id);
          }
          
          if (!goesToOtherTerminal) {
            return; // Skip this departure
          }
          
          // Find the destination stop to get arrival time
          let destinationArrivalTime = null;
          const destinationStopId = stopTime.stop_id === stops.outbound.id ? stops.inbound.id : stops.outbound.id;
          const destinationStop = remainingStops.find(st => st.stop_id === destinationStopId);
          
          if (destinationStop) {
            // Use arrival_time if available, otherwise fall back to departure_time - 1 minute
            const timeToUse = destinationStop.arrival_time || destinationStop.departure_time;
            
            if (timeToUse) {
              // Parse time
              const timeParts = timeToUse.split(':');
              let hours = parseInt(timeParts[0]);
              const minutes = parseInt(timeParts[1]);
              
              // Handle times after midnight
              let arrivalDate = new Date(todayStart);
              if (hours >= 24) {
                hours -= 24;
                arrivalDate.setDate(arrivalDate.getDate() + 1);
              }
              
              arrivalDate.setHours(hours, minutes, 0, 0);
              
              // If using departure_time as fallback, subtract 1 minute
              if (!destinationStop.arrival_time && destinationStop.departure_time) {
                arrivalDate.setMinutes(arrivalDate.getMinutes() - 1);
              }
              
              // Convert from Brisbane time to UTC for consistency
              destinationArrivalTime = fromZonedTime(arrivalDate, this.timezone);
            }
          }
          
          // Determine direction based on stop sequence
          const direction = this.determineDirection(stopTime.stop_id, tripStopTimes, index, trip, stops);
          
          departures.push({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            serviceId: trip.service_id,
            departureTime: departureUTC,
            destinationArrivalTime: destinationArrivalTime, // Add arrival time
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
  determineDirection(currentStopId, allStopTimes, currentIndex, trip, stops) {
    // If no stops provided, use defaults
    if (!stops) {
      stops = { 
        outbound: { id: STOPS.bulimba, name: 'Bulimba' }, 
        inbound: { id: STOPS.riverside, name: 'Riverside' } 
      };
    }
    
    // Try to use headsign first (if it contains destination stop name)
    if (trip.trip_headsign && stops.inbound.name && stops.outbound.name) {
      const headsign = trip.trip_headsign.toLowerCase();
      const inboundName = stops.inbound.name.toLowerCase();
      const outboundName = stops.outbound.name.toLowerCase();
      
      if (headsign.includes(inboundName)) {
        return 'outbound'; // Going TO inbound stop
      } else if (headsign.includes(outboundName)) {
        return 'inbound'; // Going TO outbound stop
      }
    }

    // Fall back to checking stop sequence
    const hasInboundAfter = allStopTimes.slice(currentIndex + 1).some(st => 
      st.stop_id === stops.inbound.id
    );
    const hasOutboundAfter = allStopTimes.slice(currentIndex + 1).some(st => 
      st.stop_id === stops.outbound.id
    );
    
    if (currentStopId === stops.outbound.id && hasInboundAfter) {
      return 'outbound';
    } else if (currentStopId === stops.inbound.id && hasOutboundAfter) {
      return 'inbound';
    }
    
    // Default based on current stop
    return currentStopId === stops.outbound.id ? 'outbound' : 'inbound';
  }

  // Get all available ferry stops
  getAvailableStops() {
    if (!this.ferryStops) {
      return [];
    }
    
    // Return array of stop objects with id and name
    return Object.entries(this.ferryStops).map(([id, stop]) => ({
      id,
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng
    }));
  }

  // Get valid destinations for a given origin stop
  getValidDestinations(originStopId) {
    if (!this.stopConnectivity || !this.stopConnectivity[originStopId]) {
      return [];
    }
    
    // Return array of valid destination stop IDs
    return this.stopConnectivity[originStopId] || [];
  }

  // Get stop info by ID
  getStopInfo(stopId) {
    if (!this.ferryStops || !this.ferryStops[stopId]) {
      return null;
    }
    
    return {
      id: stopId,
      ...this.ferryStops[stopId]
    };
  }

  // Check if stops data is loaded
  hasStopsData() {
    return !!(this.ferryStops && this.stopConnectivity);
  }

}

export default new StaticGTFSService();