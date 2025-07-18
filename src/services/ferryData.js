import { STOPS, ROUTES, DEBUG_CONFIG, DEFAULT_STOPS } from '../utils/constants';
import { startOfDay, endOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import staticGtfsService from './staticGtfsService';

class FerryDataService {
  constructor() {
    this.timezone = 'Australia/Brisbane';
    this.debug = DEBUG_CONFIG.enableLogging;
    this.selectedStops = DEFAULT_STOPS;
  }

  // Debug logging helper
  log(...args) {
    if (this.debug) console.log(...args);
  }

  // Set selected stops
  setSelectedStops(stops) {
    this.selectedStops = stops;
  }

  // Filter trip updates for selected stops and ferry routes
  filterRelevantTrips(tripUpdates) {
    const relevantStopIds = [this.selectedStops.outbound.id, this.selectedStops.inbound.id];
    
    this.log('Total trip updates to filter:', tripUpdates.length);
    
    // Let's see what ferry routes we have
    const ferryRoutes = new Set();
    const stopsFound = new Set();
    
    tripUpdates.forEach(entity => {
      if (entity.tripUpdate && entity.tripUpdate.trip && entity.tripUpdate.trip.routeId) {
        const routeId = entity.tripUpdate.trip.routeId;
        if (routeId.startsWith('F')) {
          ferryRoutes.add(routeId);
        }
        
        // Check stops - let's see ALL ferry stops
        const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || [];
        if (routeId.startsWith('F')) {
          stopTimeUpdates.forEach(update => {
            if (update.stopId) {
              // Log first few stops from ferry routes to see the pattern
              if (ferryRoutes.size <= 3 && stopTimeUpdates.indexOf(update) < 3) {
                this.log(`Sample stop on ${routeId}: ${update.stopId}`);
              }
              
              if (relevantStopIds.includes(update.stopId)) {
                stopsFound.add(`${update.stopId} on route ${routeId}`);
              }
            }
          });
        }
      }
    });
    
    this.log('Ferry routes found:', Array.from(ferryRoutes).sort());
    this.log('Relevant stops found:', Array.from(stopsFound));
    
    const filtered = tripUpdates.filter(entity => {
      if (!entity.tripUpdate) return false;
      
      const trip = entity.tripUpdate.trip;
      const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || [];
      
      // Check if this trip is on a ferry route (any route starting with 'F')
      const isRelevantRoute = trip && trip.routeId && trip.routeId.startsWith('F');
      
      // Check if trip has BOTH selected stops
      const hasOutboundStop = stopTimeUpdates.some(update => 
        update.stopId === this.selectedStops.outbound.id
      );
      const hasInboundStop = stopTimeUpdates.some(update => 
        update.stopId === this.selectedStops.inbound.id
      );
      
      // Only include trips that go between our two selected stops
      if (isRelevantRoute && hasOutboundStop && hasInboundStop) {
        // Sort stops to ensure correct order before logging
        const sortedStops = [...stopTimeUpdates].sort((a, b) => {
          const seqA = parseInt(a.stopSequence) || 0;
          const seqB = parseInt(b.stopSequence) || 0;
          return seqA - seqB;
        });
        
        // Debug: log the sorted stop sequence for trips that pass initial filter
        this.log(`Trip ${trip.tripId} sorted stop sequence: ${sortedStops.map(s => `${s.stopId}(${s.stopSequence})`).join(' -> ')}`);
      }
      return isRelevantRoute && hasOutboundStop && hasInboundStop;
    });
    
    this.log(`Filtered to ${filtered.length} trips that go between ${this.selectedStops.outbound.name} and ${this.selectedStops.inbound.name}`);
    return filtered;
  }

  // Process trip updates into departure objects
  processTripUpdates(tripUpdates, vehiclePositions = []) {
    const departures = [];
    const now = new Date();
    const nowZoned = toZonedTime(now, this.timezone);
    // Show departures for the next 24 hours
    const cutoffTime = new Date(nowZoned);
    cutoffTime.setHours(cutoffTime.getHours() + 24);

    this.log('Current time (Brisbane):', nowZoned.toLocaleString('en-AU', { timeZone: this.timezone }));
    this.log('Showing departures until:', cutoffTime.toLocaleString('en-AU', { timeZone: this.timezone }));

    tripUpdates.forEach(entity => {
      const tripUpdate = entity.tripUpdate;
      const trip = tripUpdate.trip;
      let stopTimeUpdates = tripUpdate.stopTimeUpdate || [];

      // Sort stops by stopSequence to ensure correct order
      stopTimeUpdates = stopTimeUpdates.sort((a, b) => {
        const seqA = parseInt(a.stopSequence) || 0;
        const seqB = parseInt(b.stopSequence) || 0;
        return seqA - seqB;
      });

      // Validate no duplicate stops in the trip
      const stopIds = stopTimeUpdates.map(s => s.stopId);
      const uniqueStopIds = new Set(stopIds);
      if (stopIds.length !== uniqueStopIds.size) {
        if (this.debug) console.warn(`Trip ${trip.tripId} has duplicate stops! Stops: ${stopIds.join(', ')}`);
      }

      // Find vehicle position for this trip
      const vehiclePosition = vehiclePositions.find(v => 
        v.vehicle && v.vehicle.trip && v.vehicle.trip.tripId === trip.tripId
      );

      // Log stop sequence for debugging
      if (trip.routeId.startsWith('F11') || trip.routeId.startsWith('F1')) {
        this.log(`Trip ${trip.tripId} sorted stop sequence:`, 
          stopTimeUpdates.map(s => `${s.stopId}(seq:${s.stopSequence})`).join(' -> ')
        );
      }
      
      // Process each stop in the trip
      stopTimeUpdates.forEach((stopUpdate, index) => {
        // Only process Bulimba and Riverside stops
        if (stopUpdate.stopId !== STOPS.bulimba && stopUpdate.stopId !== STOPS.riverside) {
          return;
        }

        const departureTime = this.getStopTime(stopUpdate);
        if (!departureTime) return;

        // Only include departures in the next 24 hours
        const departureZoned = toZonedTime(departureTime, this.timezone);
        
        // Debug logging
        if (trip.routeId.startsWith('F11') || trip.routeId.startsWith('F1')) {
          this.log(`Checking departure: Route ${trip.routeId}, Stop ${stopUpdate.stopId}, Time: ${departureZoned.toLocaleString('en-AU', { timeZone: this.timezone })}`);
        }
        
        if (departureZoned < nowZoned || departureZoned > cutoffTime) {
          if (trip.routeId.startsWith('F11') || trip.routeId.startsWith('F1')) {
            this.log(`  -> Filtered out: ${departureZoned < nowZoned ? 'in the past' : 'beyond 24 hours'}`);
          }
          return;
        }

        // Check if this departure actually goes to the other terminal
        const goesToOtherTerminal = this.checkDestination(stopUpdate.stopId, stopTimeUpdates, index);
        if (!goesToOtherTerminal) {
          if (trip.routeId.startsWith('F11') || trip.routeId.startsWith('F1')) {
            this.log(`  -> Filtered out: Not a direct service to the other terminal`);
          }
          return;
        }

        // Determine direction based on stop sequence
        const direction = this.determineDirection(stopUpdate.stopId, stopTimeUpdates, index);
        
        departures.push({
          tripId: trip.tripId,
          routeId: trip.routeId,
          departureTime: departureTime,
          stopId: stopUpdate.stopId,
          direction: direction,
          isRealtime: stopUpdate.scheduleRelationship !== 'SCHEDULED',
          delay: stopUpdate.departure?.delay || 0,
          vehicleId: vehiclePosition?.vehicle?.vehicle?.id,
          occupancy: vehiclePosition?.vehicle?.occupancyStatus
        });
      });
    });

    this.log(`Total departures found: ${departures.length}`);
    return departures;
  }

  // Get departure time from stop update
  getStopTime(stopUpdate) {
    if (stopUpdate.departure?.time) {
      return new Date(stopUpdate.departure.time * 1000);
    } else if (stopUpdate.arrival?.time) {
      return new Date(stopUpdate.arrival.time * 1000);
    }
    return null;
  }

  // Check if ferry goes to the other terminal after current stop
  checkDestination(currentStopId, allStopTimes, currentIndex) {
    // Since trips are linear (never revisit stops), we simply check if the other terminal
    // appears after the current stop in the sequence
    
    const remainingStops = allStopTimes.slice(currentIndex + 1);
    
    if (currentStopId === this.selectedStops.outbound.id) {
      // For outbound: Check if inbound stop appears in remaining stops
      return remainingStops.some(stop => stop.stopId === this.selectedStops.inbound.id);
    } else if (currentStopId === this.selectedStops.inbound.id) {
      // For inbound: Check if outbound stop appears in remaining stops
      return remainingStops.some(stop => stop.stopId === this.selectedStops.outbound.id);
    }
    
    return false;
  }

  // Determine direction based on stop order
  determineDirection(currentStopId, allStops, currentIndex) {
    // Look for the other terminal in the stop list
    const hasInboundAfter = allStops.slice(currentIndex + 1).some(s => s.stopId === this.selectedStops.inbound.id);
    const hasOutboundAfter = allStops.slice(currentIndex + 1).some(s => s.stopId === this.selectedStops.outbound.id);
    
    if (currentStopId === this.selectedStops.outbound.id && hasInboundAfter) {
      return 'outbound'; // From outbound stop to inbound stop
    } else if (currentStopId === this.selectedStops.inbound.id && hasOutboundAfter) {
      return 'inbound'; // From inbound stop to outbound stop
    }
    
    // Default based on current stop
    return currentStopId === this.selectedStops.outbound.id ? 'outbound' : 'inbound';
  }

  // Group departures by direction
  groupByDirection(departures) {
    const grouped = {
      outbound: [], // From outbound stop to inbound stop
      inbound: []   // From inbound stop to outbound stop
    };

    departures.forEach(departure => {
      if (departure.direction === 'outbound' && departure.stopId === this.selectedStops.outbound.id) {
        grouped.outbound.push(departure);
      } else if (departure.direction === 'inbound' && departure.stopId === this.selectedStops.inbound.id) {
        grouped.inbound.push(departure);
      }
    });

    // Sort by departure time
    grouped.outbound.sort((a, b) => a.departureTime - b.departureTime);
    grouped.inbound.sort((a, b) => a.departureTime - b.departureTime);

    // Limit to next 13 departures per direction (5 initially shown + 8 more)
    grouped.outbound = grouped.outbound.slice(0, 13);
    grouped.inbound = grouped.inbound.slice(0, 13);

    return grouped;
  }

  // Merge scheduled and real-time departures
  mergeDepartures(scheduledDepartures, realtimeDepartures) {
    const merged = new Map();
    const scheduledByTripId = new Map();
    const processedRealtime = new Set();
    
    this.log(`Merging ${scheduledDepartures.length} scheduled with ${realtimeDepartures.length} realtime departures`);
    
    // Index scheduled departures by tripId and by time
    scheduledDepartures.forEach(dep => {
      // Store by tripId for exact matching
      if (!scheduledByTripId.has(dep.tripId)) {
        scheduledByTripId.set(dep.tripId, []);
      }
      scheduledByTripId.get(dep.tripId).push(dep);
      
      // Also store by time+stop for fallback matching
      const timeKey = `${dep.stopId}-${Math.floor(dep.departureTime.getTime() / 60000)}`; // Round to minute
      merged.set(timeKey, {
        ...dep,
        isRealtime: false,
        isScheduled: true
      });
    });
    
    // Process real-time departures
    realtimeDepartures.forEach(dep => {
      let matched = false;
      
      // First try exact tripId match
      if (scheduledByTripId.has(dep.tripId)) {
        this.log(`Found exact tripId match for ${dep.tripId}`);
        const scheduledTrips = scheduledByTripId.get(dep.tripId);
        
        // Find the matching stop within this trip
        const matchingScheduled = scheduledTrips.find(s => s.stopId === dep.stopId);
        if (matchingScheduled) {
          // Calculate time difference
          const timeDiff = Math.abs(dep.departureTime - matchingScheduled.departureTime) / 60000; // minutes
          this.log(`  Trip ${dep.tripId} at stop ${dep.stopId}: ${timeDiff.toFixed(1)} min difference`);
          
          // Replace scheduled with real-time data
          const timeKey = `${matchingScheduled.stopId}-${Math.floor(matchingScheduled.departureTime.getTime() / 60000)}`;
          merged.set(timeKey, {
            ...dep,
            isRealtime: true,
            isScheduled: false,
            scheduledTime: matchingScheduled.departureTime // Keep reference to original scheduled time
          });
          matched = true;
          processedRealtime.add(`${dep.tripId}-${dep.stopId}`);
        } else {
          console.log(`Trip ${dep.tripId} exists in schedule but not for stop ${dep.stopId}`);
        }
      } else {
        console.log(`No scheduled trip found for real-time trip ${dep.tripId}`);
      }
      
      // If no exact tripId match, try time-based matching with route verification
      if (!matched) {
        const timeKey = `${dep.stopId}-${Math.floor(dep.departureTime.getTime() / 60000)}`;
        
        // Look within a 10-minute window for same route
        for (let i = -10; i <= 10; i++) {
          const checkKey = `${dep.stopId}-${Math.floor(dep.departureTime.getTime() / 60000) + i}`;
          const existing = merged.get(checkKey);
          
          if (existing && existing.routeId === dep.routeId && !processedRealtime.has(`${existing.tripId}-${existing.stopId}`)) {
            this.log(`Time-based match: Trip ${dep.tripId} matched with scheduled trip ${existing.tripId} (${i} min diff)`);
            
            // Replace with real-time data
            merged.set(checkKey, {
              ...dep,
              isRealtime: true,
              isScheduled: false,
              scheduledTime: existing.departureTime
            });
            matched = true;
            processedRealtime.add(`${dep.tripId}-${dep.stopId}`);
            break;
          }
        }
      }
      
      // If still no match, add as new real-time departure
      if (!matched) {
        this.log(`No match found for realtime trip ${dep.tripId} at ${dep.stopId}`);
        const timeKey = `${dep.stopId}-${Math.floor(dep.departureTime.getTime() / 60000)}`;
        merged.set(timeKey, {
          ...dep,
          isRealtime: true,
          isScheduled: false
        });
      }
    });
    
    const result = Array.from(merged.values());
    this.log(`Merge complete: ${result.length} total departures`);
    return result;
  }

  // Debug export function to analyze raw GTFS data
  exportDebugData(tripUpdates, vehiclePositions = []) {
    const debugData = {
      exportTime: new Date().toISOString(),
      timezone: this.timezone,
      totalTripUpdates: tripUpdates.length,
      ferryTrips: [],
      allStopIds: new Set(),
      allRouteIds: new Set(),
      bulimbaRiversideTrips: []
    };

    // Analyze all trips
    tripUpdates.forEach(entity => {
      if (!entity.tripUpdate) return;
      
      const trip = entity.tripUpdate.trip;
      const stopTimeUpdates = entity.tripUpdate.stopTimeUpdate || [];
      
      // Collect route IDs
      if (trip.routeId) {
        debugData.allRouteIds.add(trip.routeId);
      }
      
      // Only process ferry routes (starting with F)
      if (!trip.routeId || !trip.routeId.startsWith('F')) return;
      
      // Collect all stop IDs from ferries
      stopTimeUpdates.forEach(stop => {
        if (stop.stopId) {
          debugData.allStopIds.add(stop.stopId);
        }
      });
      
      // Full trip data for ferry routes
      const tripData = {
        tripId: trip.tripId,
        routeId: trip.routeId,
        directionId: trip.directionId,
        startTime: trip.startTime,
        startDate: trip.startDate,
        scheduleRelationship: trip.scheduleRelationship,
        stopCount: stopTimeUpdates.length,
        stops: stopTimeUpdates.map((stop, index) => ({
          index,
          stopId: stop.stopId,
          stopSequence: stop.stopSequence,
          arrival: stop.arrival ? {
            time: stop.arrival.time,
            delay: stop.arrival.delay,
            uncertainty: stop.arrival.uncertainty,
            timeString: stop.arrival.time ? new Date(stop.arrival.time * 1000).toLocaleString('en-AU', { timeZone: this.timezone }) : null
          } : null,
          departure: stop.departure ? {
            time: stop.departure.time,
            delay: stop.departure.delay,
            uncertainty: stop.departure.uncertainty,
            timeString: stop.departure.time ? new Date(stop.departure.time * 1000).toLocaleString('en-AU', { timeZone: this.timezone }) : null
          } : null,
          scheduleRelationship: stop.scheduleRelationship,
          platformCode: stop.platformCode
        })),
        stopSequence: stopTimeUpdates.map(s => s.stopId).join(' -> ')
      };
      
      debugData.ferryTrips.push(tripData);
      
      // Check if includes Bulimba and Riverside
      const hasBulimba = stopTimeUpdates.some(s => s.stopId === STOPS.bulimba);
      const hasRiverside = stopTimeUpdates.some(s => s.stopId === STOPS.riverside);
      
      if (hasBulimba && hasRiverside) {
        debugData.bulimbaRiversideTrips.push({
          ...tripData,
          bulimbaStops: stopTimeUpdates.filter(s => s.stopId === STOPS.bulimba).map(s => ({
            stopSequence: s.stopSequence,
            time: s.departure?.time || s.arrival?.time,
            timeString: (s.departure?.time || s.arrival?.time) ? 
              new Date((s.departure?.time || s.arrival?.time) * 1000).toLocaleString('en-AU', { timeZone: this.timezone }) : null
          })),
          riversideStops: stopTimeUpdates.filter(s => s.stopId === STOPS.riverside).map(s => ({
            stopSequence: s.stopSequence,
            time: s.departure?.time || s.arrival?.time,
            timeString: (s.departure?.time || s.arrival?.time) ? 
              new Date((s.departure?.time || s.arrival?.time) * 1000).toLocaleString('en-AU', { timeZone: this.timezone }) : null
          }))
        });
      }
    });
    
    // Convert sets to arrays
    debugData.allStopIds = Array.from(debugData.allStopIds).sort();
    debugData.allRouteIds = Array.from(debugData.allRouteIds).sort();
    
    // Add vehicle positions
    debugData.vehiclePositions = vehiclePositions.map(v => ({
      tripId: v.vehicle?.trip?.tripId,
      routeId: v.vehicle?.trip?.routeId,
      position: v.vehicle?.position,
      currentStopSequence: v.vehicle?.currentStopSequence,
      stopId: v.vehicle?.stopId,
      currentStatus: v.vehicle?.currentStatus,
      occupancyStatus: v.vehicle?.occupancyStatus,
      vehicleId: v.vehicle?.vehicle?.id
    }));
    
    return debugData;
  }

  // Get only real-time departures (fast)
  async getRealtimeDepartures(tripUpdates, vehiclePositions = []) {
    // Filter for relevant real-time trips
    const relevantTrips = this.filterRelevantTrips(tripUpdates);
    
    // Process real-time updates into departure objects
    const realtimeDepartures = this.processTripUpdates(relevantTrips, vehiclePositions);
    this.log(`Found ${realtimeDepartures.length} real-time departures`);
    
    // Group by direction
    return this.groupByDirection(realtimeDepartures);
  }

  // Get scheduled departures asynchronously (slow)
  async getScheduledDeparturesAsync() {
    try {
      const allScheduledDepartures = await staticGtfsService.getScheduledDepartures();
      this.log(`Found ${allScheduledDepartures.length} total scheduled departures from static GTFS`);
      
      // We need to check trip sequences to ensure destination comes after origin
      // Group departures by tripId
      const departuresByTrip = {};
      allScheduledDepartures.forEach(dep => {
        if (!departuresByTrip[dep.tripId]) {
          departuresByTrip[dep.tripId] = [];
        }
        departuresByTrip[dep.tripId].push(dep);
      });
      
      // Filter for trips that go from origin to destination
      const validDepartures = [];
      
      Object.entries(departuresByTrip).forEach(([tripId, tripDepartures]) => {
        // Sort by stop sequence
        tripDepartures.sort((a, b) => (a.stopSequence || 0) - (b.stopSequence || 0));
        
        // Find if this trip has both our stops
        const outboundIndex = tripDepartures.findIndex(dep => dep.stopId === this.selectedStops.outbound.id);
        const inboundIndex = tripDepartures.findIndex(dep => dep.stopId === this.selectedStops.inbound.id);
        
        // If trip has both stops and goes in the right direction
        if (outboundIndex !== -1 && inboundIndex !== -1 && inboundIndex > outboundIndex) {
          // This trip goes from outbound to inbound stop
          const outboundDep = tripDepartures[outboundIndex];
          validDepartures.push({
            ...outboundDep,
            direction: 'outbound'
          });
        }
        
        // Also check the reverse direction
        if (outboundIndex !== -1 && inboundIndex !== -1 && outboundIndex > inboundIndex) {
          // This trip goes from inbound to outbound stop
          const inboundDep = tripDepartures[inboundIndex];
          validDepartures.push({
            ...inboundDep,
            direction: 'inbound'
          });
        }
      });
      
      this.log(`Filtered to ${validDepartures.length} valid departures for selected route`);
      return validDepartures;
    } catch (error) {
      console.error('Error fetching scheduled departures:', error);
      return [];
    }
  }

  // Merge scheduled data with existing real-time grouped data
  mergeWithScheduledData(groupedRealtimeData, scheduledDepartures) {
    // Flatten the grouped data to merge
    const allRealtime = [
      ...groupedRealtimeData.outbound,
      ...groupedRealtimeData.inbound
    ];
    
    console.log('Merging data:', {
      realtimeCount: allRealtime.length,
      scheduledCount: scheduledDepartures.length,
      realtimeTripIds: allRealtime.map(d => d.tripId).slice(0, 5),
      scheduledTripIds: scheduledDepartures.map(d => d.tripId).slice(0, 5)
    });
    
    // Merge scheduled and real-time data
    const allDepartures = this.mergeDepartures(scheduledDepartures, allRealtime);
    this.log(`Total merged departures: ${allDepartures.length}`);
    
    // Log sample of merged data
    console.log('Sample merged departures:', allDepartures.slice(0, 3).map(d => ({
      tripId: d.tripId,
      isRealtime: d.isRealtime,
      time: d.departureTime
    })));
    
    // Group by direction again
    return this.groupByDirection(allDepartures);
  }

  // Main function to get processed ferry data (kept for backward compatibility)
  async getFerryDepartures(tripUpdates, vehiclePositions = []) {
    // Get scheduled departures from static GTFS
    let scheduledDepartures = [];
    try {
      scheduledDepartures = await staticGtfsService.getScheduledDepartures();
      this.log(`Found ${scheduledDepartures.length} scheduled departures from static GTFS`);
    } catch (error) {
      console.error('Error fetching scheduled departures:', error);
    }
    
    // Filter for relevant real-time trips
    const relevantTrips = this.filterRelevantTrips(tripUpdates);
    
    // Process real-time updates into departure objects
    const realtimeDepartures = this.processTripUpdates(relevantTrips, vehiclePositions);
    this.log(`Found ${realtimeDepartures.length} real-time departures`);
    
    // Merge scheduled and real-time data
    const allDepartures = this.mergeDepartures(scheduledDepartures, realtimeDepartures);
    this.log(`Total merged departures: ${allDepartures.length}`);
    
    // Group by direction
    return this.groupByDirection(allDepartures);
  }
}

export default new FerryDataService();