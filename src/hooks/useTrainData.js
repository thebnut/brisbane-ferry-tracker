import { useState, useEffect, useCallback, useRef } from 'react';
import { useModeConfig } from '../config';

/**
 * Train Data Hook
 *
 * Fetches static train schedule data from the Train API
 * Phase 3: Static schedules only (no real-time tracking)
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

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const schedule = await response.json();

      // Transform API response to match expected departure format
      const transformedData = {
        origin: schedule.origin,
        destination: schedule.destination,
        departures: schedule.departures || [],
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
    loading,
    error,
    lastUpdated,
    refresh: fetchSchedule
  };
};

export default useTrainData;
