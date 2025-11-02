import { useState, useEffect, useCallback, useRef } from 'react';
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
 */
const useTrainData = (origin, destination, hours = 4) => {
  const modeConfig = useModeConfig();
  const [data, setData] = useState(null);
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
      setData(null);
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
      const tripUpdateMap = new Map();
      tripUpdates.forEach(entity => {
        if (entity.tripUpdate?.trip?.tripId) {
          tripUpdateMap.set(entity.tripUpdate.trip.tripId, entity.tripUpdate);
        }
      });

      const vehicleMap = new Map();
      vehiclePositions.forEach(entity => {
        if (entity.vehicle?.trip?.tripId) {
          vehicleMap.set(entity.vehicle.trip.tripId, entity.vehicle);
        }
      });

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

          // Look up realtime data for this trip
          const tripUpdate = tripUpdateMap.get(dep.tripId);
          const vehicle = vehicleMap.get(dep.tripId);

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

      const transformedData = {
        origin: schedule.origin,
        destination: schedule.destination,
        departures: transformedDepartures,
        totalDepartures: schedule.totalDepartures || 0,
        meta: schedule.meta || {}
      };

      setData(transformedData);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error fetching train schedule:', err);
      setError(err.message || 'Failed to load train schedule');
      setData(null);
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
      setData(null);
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
      setData(prev => prev ? { ...prev } : null);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

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
