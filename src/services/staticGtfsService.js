import JSZip from 'jszip';
import Papa from 'papaparse';
import { STOPS, ROUTES, DEBUG_CONFIG, STORAGE_KEYS } from '../utils/constants';
import { startOfDay, endOfDay, format, parse, isAfter, isBefore, addMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

class StaticGTFSService {
  constructor() {
    this.timezone = 'Australia/Brisbane';
    this.mode = 'ferry'; // Default mode, will be updated from ModeProvider
    this.scheduleCacheKey = STORAGE_KEYS.SCHEDULE_CACHE;
    this.transitEnv = import.meta.env.VITE_TRANSIT_ENV || 'prod';
    this.devScheduleBase = import.meta.env.VITE_TRANSIT_DEV_BASE || '';
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.gtfsData = null;
    this.modeStops = null;
    this.routeAllowSet = null;
    this.modeConfig = null;
    this.stopConnectivity = null;
    this.debug = DEBUG_CONFIG.enableLogging;

    // Circuit breaker for failed fetches to prevent infinite 404 loops
    this.fetchFailures = new Map(); // mode -> { count, lastAttempt }
    this.maxFailures = 3;
    this.retryBackoff = 30000; // 30 seconds
    
    // URL parameter support: Add ?useGitHub=true to use GitHub data on localhost
    // This helps developers test with the latest production data
    const urlParams = new URLSearchParams(window.location.search);
    const forceGitHub = urlParams.get('useGitHub') || urlParams.get('useGithub');
    
    // Mode will be set later, use ferry as default
    this.updateScheduleUrls(forceGitHub);
    
    // Log the data source for debugging on localhost
    if (window.location.hostname === 'localhost') {
      console.log(`📍 Using ${forceGitHub ? 'GitHub' : 'local'} schedule data`);
    }
  }

  // Set the mode for this service
  setMode(mode) {
    this.mode = mode;
    // Update cache key to be mode-specific
    this.scheduleCacheKey = `${STORAGE_KEYS.SCHEDULE_CACHE}_${mode}`;
    // Update URLs when mode changes
    const urlParams = new URLSearchParams(window.location.search);
    const forceGitHub = urlParams.get('useGitHub') || urlParams.get('useGithub');
    this.updateScheduleUrls(forceGitHub);
  }

  setModeConfig(config) {
    this.modeConfig = config;
  }

  // Update schedule URLs based on mode
  updateScheduleUrls(forceGitHub) {
    const prodBasePath = 'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data';

    // Default (production) paths
    let primaryUrl;
    let fallbackUrl = null;

    if (window.location.hostname === 'localhost' && !forceGitHub) {
      primaryUrl = `/schedule-data/${this.mode}/latest.json`;
      if (this.mode === 'ferry') {
        fallbackUrl = '/schedule-data/latest.json';
      }
    } else {
      primaryUrl = `${prodBasePath}/${this.mode}/latest.json`;
      if (this.mode === 'ferry') {
        fallbackUrl = `${prodBasePath}/latest.json`;
      }
    }

    // Development overrides (use schedule-data-dev or custom base)
    if (this.transitEnv === 'dev') {
      const trimmedBase = this.devScheduleBase.replace(/\/$/, '');
      const devUrl = trimmedBase
        ? `${trimmedBase}/${this.mode}/latest.json`
        : `/schedule-data-dev/${this.mode}/latest.json`;

      this.githubScheduleUrl = devUrl;
      this.fallbackScheduleUrl = primaryUrl;
      this.log(`Schedule URL for ${this.mode} (dev env): ${this.githubScheduleUrl} (fallback ${this.fallbackScheduleUrl})`);
      return;
    }

    this.githubScheduleUrl = primaryUrl;
    this.fallbackScheduleUrl = fallbackUrl;
    this.log(`Schedule URL for ${this.mode}: ${this.githubScheduleUrl}`);
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
          this.log('Using cached schedule');
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
      this.log('Cached schedule successfully');
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
    // Check circuit breaker to prevent infinite 404 loops
    const failureInfo = this.fetchFailures.get(this.mode);
    if (failureInfo) {
      const timeSinceLastAttempt = Date.now() - failureInfo.lastAttempt;
      if (failureInfo.count >= this.maxFailures && timeSinceLastAttempt < this.retryBackoff) {
        this.log(`Circuit breaker active for ${this.mode} - skipping fetch (${failureInfo.count} failures)`);
        return null;
      }
    }

    try {
      this.log(`Fetching pre-processed ${this.mode} schedule from GitHub...`);
      let response = await fetch(this.githubScheduleUrl);

      // Try fallback URL if primary fails (for ferry backward compatibility)
      if (!response.ok && this.fallbackScheduleUrl) {
        this.log(`Primary URL failed (${response.status}), trying fallback for ${this.mode}...`);
        response = await fetch(this.fallbackScheduleUrl);
      }

      if (!response.ok) {
        throw new Error(`GitHub schedule fetch failed: ${response.status}`);
      }

      // Success - reset circuit breaker
      this.fetchFailures.delete(this.mode);
      
      const data = await response.json();
      this.log(`Received ${data.departureCount} departures from GitHub`);
      
      // Store stops/connectivity data if available
      const stopsData = data.stops || data.modeStops || data.ferryStops;
      if (stopsData) {
        this.modeStops = stopsData;
        this.log(`Loaded ${Object.keys(stopsData).length} stops for ${this.mode}`);
      }

      if (data.stopConnectivity) {
        this.stopConnectivity = data.stopConnectivity;
        this.log('Loaded stop connectivity data');
      }

      if (Array.isArray(data.routeAllowSet)) {
        this.routeAllowSet = new Set(data.routeAllowSet);
        this.log(`Loaded route allow-set with ${this.routeAllowSet.size} routes`);
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
      // Increment failure count for circuit breaker
      const currentFailures = this.fetchFailures.get(this.mode) || { count: 0, lastAttempt: 0 };
      this.fetchFailures.set(this.mode, {
        count: currentFailures.count + 1,
        lastAttempt: Date.now()
      });

      this.log(`GitHub schedule fetch failed (attempt ${currentFailures.count + 1}):`, error.message);
      return null;
    }
  }

  // Process GitHub departures to calculate arrival times and filter for selected stops
  processGitHubDepartures(allDepartures, selectedStops) {
    const stops = this.resolveSelectedStops(selectedStops);
    if (!stops) {
      return [];
    }

    const outboundId = stops.outbound.id;
    const inboundId = stops.inbound.id;
    const routeAllowSet = this.routeAllowSet;

    const departuresByTrip = new Map();
    allDepartures.forEach(dep => {
      const list = departuresByTrip.get(dep.tripId) || [];
      list.push({
        ...dep,
        departureTime: dep.departureTime instanceof Date ? dep.departureTime : new Date(dep.departureTime),
        destinationArrivalTime: dep.destinationArrivalTime
          ? (dep.destinationArrivalTime instanceof Date ? dep.destinationArrivalTime : new Date(dep.destinationArrivalTime))
          : null
      });
      departuresByTrip.set(dep.tripId, list);
    });

    const processedDepartures = [];
    departuresByTrip.forEach(tripStops => {
      if (!tripStops.length) return;
      const routeId = tripStops[0].routeId;
      if (routeAllowSet && routeId && !routeAllowSet.has(routeId)) {
        return;
      }

      tripStops.sort((a, b) => (a.stopSequence || 0) - (b.stopSequence || 0));

      const outboundIndex = tripStops.findIndex(stop => stop.stopId === outboundId);
      const inboundIndex = tripStops.findIndex(stop => stop.stopId === inboundId);

      if (outboundIndex !== -1 && inboundIndex !== -1) {
        if (outboundIndex < inboundIndex) {
          const origin = tripStops[outboundIndex];
          const destination = tripStops[inboundIndex];
          processedDepartures.push(this.buildScheduledDeparture(origin, destination, 'outbound'));
        }
        if (inboundIndex < outboundIndex) {
          const origin = tripStops[inboundIndex];
          const destination = tripStops[outboundIndex];
          processedDepartures.push(this.buildScheduledDeparture(origin, destination, 'inbound'));
        }
      }
    });

    processedDepartures.sort((a, b) => a.departureTime - b.departureTime);

    if (this.debug && processedDepartures.length) {
      this.log(`Processed ${processedDepartures.length} departures for ${this.mode}`);
    }
    return processedDepartures;
  }

  buildScheduledDeparture(originStop, destinationStop, direction) {
    const destinationArrivalTime = destinationStop
      ? (destinationStop.destinationArrivalTime || destinationStop.departureTime)
      : null;

    return {
      tripId: originStop.tripId,
      routeId: originStop.routeId,
      serviceId: originStop.serviceId,
      departureTime: originStop.departureTime,
      destinationArrivalTime: destinationArrivalTime
        ? (destinationArrivalTime instanceof Date ? destinationArrivalTime : new Date(destinationArrivalTime))
        : null,
      stopId: originStop.stopId,
      direction,
      headsign: originStop.headsign,
      isScheduled: true,
      stopSequence: originStop.stopSequence
    };
  }

  resolveSelectedStops(selectedStops) {
    if (selectedStops && selectedStops.outbound && selectedStops.inbound) {
      return selectedStops;
    }

    const defaults = this.modeConfig?.data?.stops?.defaults;
    if (!defaults) return null;

    const findName = (id) => {
      if (!id) return '';
      if (Array.isArray(this.modeConfig?.data?.stops?.list)) {
        const match = this.modeConfig.data.stops.list.find(stop => stop.id === id);
        if (match) return match.name;
      }
      if (this.modeStops && this.modeStops[id]) {
        return this.modeStops[id].name;
      }
      return '';
    };

    return {
      outbound: { id: defaults.origin, name: findName(defaults.origin) },
      inbound: { id: defaults.destination, name: findName(defaults.destination) }
    };
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

    if (this.mode !== 'ferry') {
      this.log('No schedule data available from GitHub/cache for non-ferry mode');
      return [];
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
    if (this.modeStops) {
      return Object.entries(this.modeStops).map(([id, stop]) => ({
        id,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng
      }));
    }

    if (Array.isArray(this.modeConfig?.data?.stops?.list)) {
      return this.modeConfig.data.stops.list;
    }

    return [];
  }

  // Get valid destinations for a given origin stop
  getValidDestinations(originStopId) {
    if (!this.stopConnectivity || !this.stopConnectivity[originStopId]) {
      if (this.modeStops) {
        return Object.keys(this.modeStops).filter(id => id !== originStopId);
      }
      if (Array.isArray(this.modeConfig?.data?.stops?.list)) {
        return this.modeConfig.data.stops.list
          .map(stop => stop.id)
          .filter(id => id !== originStopId);
      }
      return [];
    }
    
    // Return array of valid destination stop IDs
    return this.stopConnectivity[originStopId] || [];
  }

  // Get stop info by ID
  getStopInfo(stopId) {
    if (!this.modeStops || !this.modeStops[stopId]) {
      return null;
    }
    
    return {
      id: stopId,
      ...this.modeStops[stopId]
    };
  }

  // Check if stops data is loaded
  hasStopsData() {
    return !!this.modeStops;
  }

  // Get schedule metadata including route allow-set
  async getScheduleMetadata() {
    // Check circuit breaker first
    const failureInfo = this.fetchFailures.get(this.mode);
    if (failureInfo) {
      const timeSinceLastAttempt = Date.now() - failureInfo.lastAttempt;
      if (failureInfo.count >= this.maxFailures && timeSinceLastAttempt < this.retryBackoff) {
        this.log(`Circuit breaker active for ${this.mode} metadata - using cache or defaults`);
        // Return from cache if available
        const cached = localStorage.getItem(this.scheduleCacheKey);
        if (cached) {
          try {
            const data = JSON.parse(cached);
            if (data.routeAllowSet) {
              return {
                mode: data.mode || this.mode,
                routeAllowSet: data.routeAllowSet,
                generated: data.generated,
                stops: data.stops || data.modeStops
              };
            }
          } catch (e) {
            // Ignore cache parse errors
          }
        }
        // Return empty metadata to prevent further attempts
        return {
          mode: this.mode,
          routeAllowSet: [],
          generated: null,
          stops: {}
        };
      }
    }

    try {
      // Try to get from cache first
      const cached = localStorage.getItem(this.scheduleCacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (data.routeAllowSet) {
          return {
            mode: data.mode || this.mode,
            routeAllowSet: data.routeAllowSet,
            generated: data.generated,
            stops: data.stops || data.modeStops
          };
        }
      }

      // Fetch fresh metadata
      const response = await fetch(this.githubScheduleUrl);
      if (!response.ok && this.fallbackScheduleUrl) {
        const fallbackResponse = await fetch(this.fallbackScheduleUrl);
        if (fallbackResponse.ok) {
          const data = await fallbackResponse.json();
          // Success with fallback - reset circuit breaker
          this.fetchFailures.delete(this.mode);
          return {
            mode: data.mode || this.mode,
            routeAllowSet: data.routeAllowSet || [],
            generated: data.generated,
            stops: data.stops || data.modeStops
          };
        }
      }

      if (response.ok) {
        const data = await response.json();
        // Success - reset circuit breaker
        this.fetchFailures.delete(this.mode);
        return {
          mode: data.mode || this.mode,
          routeAllowSet: data.routeAllowSet || [],
          generated: data.generated,
          stops: data.stops || data.modeStops
        };
      }
    } catch (error) {
      // Increment failure count
      const currentFailures = this.fetchFailures.get(this.mode) || { count: 0, lastAttempt: 0 };
      this.fetchFailures.set(this.mode, {
        count: currentFailures.count + 1,
        lastAttempt: Date.now()
      });
      console.error(`Failed to get schedule metadata (attempt ${currentFailures.count + 1}):`, error);
    }

    // Return empty metadata as fallback
    return {
      mode: this.mode,
      routeAllowSet: [],
      generated: null,
      stops: {}
    };
  }

}

export default new StaticGTFSService();
