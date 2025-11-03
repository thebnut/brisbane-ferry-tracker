import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useModeConfig } from '../config';
import gtfsService from '../services/gtfsService';

/**
 * Train Data Hook
 *
 * Fetches static train schedule data from the Train API
 * AND overlays realtime GTFS-RT data for live tracking
 *
 * @param {string} origin - Origin station stop ID
 * @param {string} destination - Destination station stop ID
 * @param {number} hours - Time window in hours (default: 4)
 * @param {Date|null} departureTimeFilter - Optional filter to show only departures after this time
 */
const useTrainData = (origin, destination, hours = 4, departureTimeFilter = null) => {
  const modeConfig = useModeConfig();
  const [unfilteredData, setUnfilteredData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rawGtfsData, setRawGtfsData] = useState({ tripUpdates: [], vehiclePositions: [] });

  const fetchDataRef = useRef(null);
  const lastFetchTime = useRef(0);
  const MIN_FETCH_INTERVAL = 5000; // Minimum 5 seconds between fetches

  const fetchSchedule = useCallback(async () => {
    // Don't fetch if origin or destination not selected
    if (!origin || !destination) {
      setUnfilteredData(null);
      setLoading(false);
      return;
    }

    // Throttle requests
    const now = Date.now();
    if (now - lastFetchTime.current < MIN_FETCH_INTERVAL) {
      console.log('Throttling train API request');
      return;
    }
    lastFetchTime.current = now;

    setLoading(true);
    setError(null);

    try {
      const apiBaseUrl = modeConfig?.data?.api?.baseUrl || '/api/schedule/train';
      const apiEndpoint = modeConfig?.data?.api?.endpoint || '/route';

      const url = `${apiBaseUrl}${apiEndpoint}?origin=${origin}&destination=${destination}&hours=${hours}`;
      console.log('Fetching train schedule:', url);

      // Fetch static schedule
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const schedule = await response.json();

      // Fetch GTFS-RT data for realtime overlays
      gtfsService.setMode('train');
      let tripUpdates = [];
      let vehiclePositions = [];

      try {
        const realtimeData = await gtfsService.getAllData();
        tripUpdates = realtimeData.tripUpdates || [];
        vehiclePositions = realtimeData.vehiclePositions || [];
        setRawGtfsData({ tripUpdates, vehiclePositions });
        console.log(`Fetched ${tripUpdates.length} trip updates, ${vehiclePositions.length} vehicle positions`);
      } catch (rtError) {
        console.warn('Failed to fetch GTFS-RT data, continuing with static schedule only:', rtError);
        // Continue with static schedule if realtime fails
      }

      // Build lookup maps for fast merging
      // Use fuzzy matching because service IDs change daily (40750 vs 40751)
      // TripId format: "34564240-QR 25_26-40750-DA13"
      //                 ^^^^^^^  sequence number (stable)
      //                          ^^^^^^^^ route
      //                                   ^^^^^ service ID (changes daily!)
      //                                         ^^^^ block/trip suffix

      // Map by trip sequence number for fuzzy matching
      const tripUpdateBySequence = new Map();
      tripUpdates.forEach(entity => {
        if (entity.tripUpdate?.trip?.tripId) {
          const tripId = entity.tripUpdate.trip.tripId;
          const sequence = tripId.split('-')[0]; // First part: "34564240"

          // Store both full tripId and entity
          if (!tripUpdateBySequence.has(sequence)) {
            tripUpdateBySequence.set(sequence, []);
          }
          tripUpdateBySequence.get(sequence).push({
            tripId,
            entity: entity.tripUpdate
          });
        }
      });

      const vehicleMap = new Map();
      vehiclePositions.forEach(entity => {
        if (entity.vehicle?.trip?.tripId) {
          const tripId = entity.vehicle.trip.tripId;
          const sequence = tripId.split('-')[0];
          vehicleMap.set(sequence, entity.vehicle);
        }
      });

      // DEBUG: Log sample static trip IDs
      const sampleStatic = (schedule.departures || []).slice(0, 3).map(d => d.tripId);
      console.log('[RT-DEBUG] Sample static tripIds:', sampleStatic);
      console.log('[RT-DEBUG] Sample RT sequences:', Array.from(tripUpdateBySequence.keys()).slice(0, 3));

      // Transform API response and merge with realtime data
      // Convert scheduledDeparture (time string) to departureTime (Date object)
      const transformedDepartures = (schedule.departures || [])
        .map(dep => {
          // Parse time string (HH:MM:SS) and create today's date with that time
          const [hours, minutes, seconds] = dep.scheduledDeparture.split(':').map(Number);
          const now = new Date();
          const scheduledDepartureTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds || 0);

          // If departure is before now, assume it's tomorrow (for late-night services)
          if (scheduledDepartureTime < now && (now.getHours() >= 20 || scheduledDepartureTime.getHours() <= 4)) {
            scheduledDepartureTime.setDate(scheduledDepartureTime.getDate() + 1);
          }

          // Look up realtime data for this trip using sequence number
          const staticSequence = dep.tripId.split('-')[0];
          const tripUpdateMatches = tripUpdateBySequence.get(staticSequence);
          const vehicle = vehicleMap.get(staticSequence);

          // Find best matching trip update (there might be multiple for same sequence)
          let tripUpdate = null;
          if (tripUpdateMatches && tripUpdateMatches.length > 0) {
            // If only one match, use it
            if (tripUpdateMatches.length === 1) {
              tripUpdate = tripUpdateMatches[0].entity;
            } else {
              // Multiple matches - try to find one that matches route/block
              const staticRoute = dep.tripId.split('-')[1]; // "QR 25_26"
              const match = tripUpdateMatches.find(m => m.tripId.includes(staticRoute));
              tripUpdate = match ? match.entity : tripUpdateMatches[0].entity;
            }
          }

          // If we have realtime data for this trip
          if (tripUpdate) {
            // Find the departure stop in the trip update
            // Match by time proximity (within 5 minutes of scheduled time)
            const scheduledTimestamp = scheduledDepartureTime.getTime() / 1000;
            const originStopUpdate = tripUpdate.stopTimeUpdate?.find(stu => {
              const stopTime = stu.departure?.time || stu.arrival?.time;
              return stopTime && Math.abs(stopTime - scheduledTimestamp) < 300; // 5 min window
            });

            if (originStopUpdate?.departure) {
              const delay = originStopUpdate.departure.delay || 0;
              const rtTimestamp = originStopUpdate.departure.time;
              const rtDepartureTime = rtTimestamp
                ? new Date(rtTimestamp * 1000)
                : new Date(scheduledDepartureTime.getTime() + delay * 1000);

              return {
                ...dep,
                departureTime: rtDepartureTime,
                scheduledTime: scheduledDepartureTime,
                isRealtime: true,
                delay: delay,
                vehicleId: vehicle?.vehicle?.id,
                occupancy: vehicle?.occupancyStatus,
                stopId: dep.platformDetails?.origin?.id || '',
                direction: 'outbound'
              };
            }
          }

          // No realtime data - return scheduled
          return {
            ...dep,
            departureTime: scheduledDepartureTime,
            isRealtime: false,
            isScheduled: true,
            delay: 0,
            stopId: dep.platformDetails?.origin?.id || '',
            direction: 'outbound'
          };
        })
        .sort((a, b) => a.departureTime - b.departureTime); // Sort chronologically

      // DEBUG: Count how many trips matched
      const realtimeCount = transformedDepartures.filter(d => d.isRealtime).length;
      console.log(`[RT-DEBUG] Matched ${realtimeCount}/${transformedDepartures.length} trips with realtime data`);

      const transformedData = {
        origin: schedule.origin,
        destination: schedule.destination,
        departures: transformedDepartures,
        totalDepartures: schedule.totalDepartures || 0,
        meta: schedule.meta || {}
      };

      setUnfilteredData(transformedData);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error fetching train schedule:', err);
      setError(err.message || 'Failed to load train schedule');
      setUnfilteredData(null);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, hours, modeConfig]);

  // Store latest fetchSchedule in ref
  useEffect(() => {
    fetchDataRef.current = fetchSchedule;
  }, [fetchSchedule]);

  // Fetch data when origin/destination changes
  useEffect(() => {
    if (origin && destination) {
      setLoading(true);
      if (fetchDataRef.current) {
        fetchDataRef.current();
      }
    } else {
      setUnfilteredData(null);
      setLoading(false);
    }
  }, [origin, destination, hours]);

  // Set up auto-refresh interval
  useEffect(() => {
    if (!origin || !destination) return;

    // Get refresh interval from mode config, default to 5 minutes
    const refreshInterval = modeConfig?.data?.api?.refreshInterval || 300000;
    console.log(`Setting up train data auto-refresh: ${refreshInterval / 1000}s`);

    const interval = setInterval(() => {
      console.log('Auto-refresh triggered for train data');
      if (fetchDataRef.current) {
        fetchDataRef.current();
      }
    }, refreshInterval);

    return () => {
      console.log('Cleaning up train data auto-refresh');
      clearInterval(interval);
    };
  }, [origin, destination, modeConfig?.data?.api?.refreshInterval]);

  // Set up countdown timer refresh (every second)
  useEffect(() => {
    const timer = setInterval(() => {
      // Force re-render to update countdown displays
      setUnfilteredData(prev => prev ? { ...prev } : null);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Apply departure time filter client-side (instant, no API call)
  const data = useMemo(() => {
    if (!unfilteredData) return null;

    // If no filter, return all data
    if (!departureTimeFilter) return unfilteredData;

    // Filter departures by time
    const filteredDepartures = unfilteredData.departures.filter(
      dep => dep.departureTime >= departureTimeFilter
    );

    console.log(`[FILTER] Client-side filter: showing ${filteredDepartures.length}/${unfilteredData.departures.length} departures from ${departureTimeFilter.toLocaleTimeString()}`);

    return {
      ...unfilteredData,
      departures: filteredDepartures
    };
  }, [unfilteredData, departureTimeFilter]);

  return {
    data,
    vehiclePositions: rawGtfsData.vehiclePositions,
    tripUpdates: rawGtfsData.tripUpdates,
    loading,
    error,
    lastUpdated,
    refresh: fetchSchedule
  };
};

export default useTrainData;
