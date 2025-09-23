import { useState, useEffect, useCallback, useRef } from 'react';
import gtfsService from '../services/gtfsService';
import ferryDataService from '../services/ferryData';
import staticGtfsService from '../services/staticGtfsService';
import { API_CONFIG, DEFAULT_STOPS } from '../utils/constants';
import { useModeConfig } from '../config';

const useFerryData = (selectedStops = DEFAULT_STOPS, departureTimeFilter = null) => {
  const modeConfig = useModeConfig();
  const modeId = modeConfig?.mode?.id || 'ferry'; // Default to ferry if not set
  const [departures, setDepartures] = useState({
    outbound: [],
    inbound: []
  });
  const [loading, setLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rawGtfsData, setRawGtfsData] = useState({ tripUpdates: [], vehiclePositions: [] });
  const [routeAllowSetLoaded, setRouteAllowSetLoaded] = useState(false);
  const fetchDataRef = useRef(null);
  const lastFetchTime = useRef(0);
  const errorCount = useRef(0);
  const MIN_FETCH_INTERVAL = 5000; // Minimum 5 seconds between fetches
  const MAX_ERROR_COUNT = 3; // Stop retrying after 3 consecutive errors
  const ERROR_BACKOFF_TIME = 30000; // 30 seconds backoff after max errors

  const fetchData = useCallback(async () => {
    // Throttle requests - prevent fetching more than once per 5 seconds
    const now = Date.now();
    if (now - lastFetchTime.current < MIN_FETCH_INTERVAL) {
      console.log('Throttling request - too soon since last fetch');
      return;
    }

    // Check if we're in error backoff period
    if (errorCount.current >= MAX_ERROR_COUNT) {
      const timeSinceLastFetch = now - lastFetchTime.current;
      if (timeSinceLastFetch < ERROR_BACKOFF_TIME) {
        console.log(`In error backoff period (${errorCount.current} errors) - skipping fetch`);
        return;
      }
      // Reset error count after backoff period
      errorCount.current = 0;
    }

    lastFetchTime.current = now;

    try {
      setError(null);

      // Set mode configuration in services
      gtfsService.setMode(modeId);
      staticGtfsService.setMode(modeId);
      if (modeConfig) {
        staticGtfsService.setModeConfig(modeConfig);
      }

      // Note: Route allow-set is loaded in a separate effect to prevent loops

      // Set selected stops and departure time filter in the service
      ferryDataService.setSelectedStops(selectedStops);
      ferryDataService.setDepartureTimeFilter(departureTimeFilter);

      // First, fetch real-time GTFS data (fast)
      const { tripUpdates, vehiclePositions } = await gtfsService.getAllData();
      
      // Store raw data for debugging
      setRawGtfsData({ tripUpdates, vehiclePositions });
      
      // Process real-time data immediately
      const realtimeDepartures = await ferryDataService.getRealtimeDepartures(
        tripUpdates,
        vehiclePositions
      );

      setDepartures(realtimeDepartures);
      setLastUpdated(new Date());
      setLoading(false); // Mark initial load complete
      
      // Then fetch schedule data in background (slow)
      setScheduleLoading(true);
      ferryDataService.getScheduledDeparturesAsync().then(scheduledData => {
        // Merge with existing real-time data
        const mergedDepartures = ferryDataService.mergeWithScheduledData(
          realtimeDepartures,
          scheduledData
        );
        setDepartures(mergedDepartures);
        setScheduleLoading(false);
      }).catch(err => {
        console.error('Error loading schedule data:', err);
        setScheduleLoading(false);
        // Continue showing real-time data even if schedule fails
      });

      // Success - reset error count
      errorCount.current = 0;
      setError(null);
    } catch (err) {
      errorCount.current++;
      console.error(`Error fetching ferry data (attempt ${errorCount.current}):`, err);
      setError(err.message || 'Failed to load ferry times');

      // If we've hit max errors, show a more informative message
      if (errorCount.current >= MAX_ERROR_COUNT) {
        setError('Multiple failures detected. Will retry in 30 seconds.');
      }

      // Keep existing data if available
      setDepartures(prev => {
        if (!prev.outbound.length && !prev.inbound.length) {
          return { outbound: [], inbound: [] };
        }
        return prev;
      });
      setLoading(false);
      setScheduleLoading(false);
    }
  }, [selectedStops, departureTimeFilter, modeId, modeConfig]);

  // Store latest fetchData in ref to avoid recreating interval
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Clear departures when filters change for immediate feedback
  useEffect(() => {
    setDepartures({ outbound: [], inbound: [] });
    setLoading(true);
    // Fetch new data when filters change
    if (fetchDataRef.current) {
      fetchDataRef.current();
    }
  }, [selectedStops, departureTimeFilter, modeId]);

  // Set up auto-refresh interval ONCE
  useEffect(() => {
    // Initial fetch
    if (fetchDataRef.current) {
      fetchDataRef.current();
    }

    // Get refresh interval from mode config, default to 5 minutes
    const refreshInterval = modeConfig?.data?.api?.refreshInterval || 300000; // 5 minutes default
    console.log(`Setting up auto-refresh with interval: ${refreshInterval}ms (${refreshInterval / 1000}s)`);

    // Set up auto-refresh interval
    const interval = setInterval(() => {
      console.log('Auto-refresh triggered');
      if (fetchDataRef.current) {
        fetchDataRef.current();
      }
    }, refreshInterval);

    // Cleanup interval on unmount
    return () => {
      console.log('Cleaning up auto-refresh interval');
      clearInterval(interval);
    };
  }, [modeConfig?.data?.api?.refreshInterval]); // Re-setup if refresh interval changes

  // Load route allow-set once per mode change
  useEffect(() => {
    if (modeConfig && modeConfig.mode && modeConfig.mode.id && !routeAllowSetLoaded) {
      console.log('Loading route allow-set for mode:', modeConfig.mode.id);
      staticGtfsService.setModeConfig(modeConfig);
      ferryDataService.setModeConfig(modeConfig);
      ferryDataService.loadRouteAllowSet()
        .then(() => {
          setRouteAllowSetLoaded(true);
          console.log('Route allow-set loaded successfully');
        })
        .catch(err => {
          console.error('Failed to load route allow-set:', err);
          // Continue without route allow-set - will use fallback filtering
        });
    }
  }, [modeConfig, routeAllowSetLoaded]); // Reload when mode config changes

  // Reset route allow-set loaded flag when mode changes
  useEffect(() => {
    setRouteAllowSetLoaded(false);
  }, [modeId]);

  // Set up countdown timer refresh (every second)
  useEffect(() => {
    const timer = setInterval(() => {
      // Force re-render to update countdown displays
      setDepartures(prev => ({ ...prev }));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Debug export function
  const exportDebugData = useCallback(() => {
    const debugData = ferryDataService.exportDebugData(
      rawGtfsData.tripUpdates,
      rawGtfsData.vehiclePositions
    );
    
    // Create and download JSON file
    const dataStr = JSON.stringify(debugData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ferry-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [rawGtfsData]);

  return {
    departures,
    vehiclePositions: rawGtfsData.vehiclePositions,
    tripUpdates: rawGtfsData.tripUpdates,
    loading,
    scheduleLoading,
    error,
    lastUpdated,
    refresh: fetchData,
    exportDebugData
  };
};

export default useFerryData;
