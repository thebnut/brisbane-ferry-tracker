import { useState, useEffect, useCallback } from 'react';
import gtfsService from '../services/gtfsService';
import ferryDataService from '../services/ferryData';
import staticGtfsService from '../services/staticGtfsService';
import { API_CONFIG, DEFAULT_STOPS } from '../utils/constants';
import { useModeConfig } from '../config';

const useFerryData = (selectedStops = DEFAULT_STOPS, departureTimeFilter = null) => {
  const modeConfig = useModeConfig();
  const modeId = modeConfig?.mode?.id;
  const [departures, setDepartures] = useState({
    outbound: [],
    inbound: []
  });
  const [loading, setLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rawGtfsData, setRawGtfsData] = useState({ tripUpdates: [], vehiclePositions: [] });

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // Set mode configuration in services
      if (modeConfig) {
        gtfsService.setMode(modeConfig.mode.id);
        staticGtfsService.setMode(modeConfig.mode.id);
        ferryDataService.setModeConfig(modeConfig);
        await ferryDataService.loadRouteAllowSet();
      }

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
      
      setError(null);
    } catch (err) {
      console.error('Error fetching ferry data:', err);
      setError(err.message || 'Failed to load ferry times');
      // Keep existing data if available
      if (!departures.outbound.length && !departures.inbound.length) {
        setDepartures({ outbound: [], inbound: [] });
      }
      setLoading(false);
      setScheduleLoading(false);
    }
  }, [selectedStops, departureTimeFilter, modeId]);

  // Clear departures when filters change for immediate feedback
  useEffect(() => {
    setDepartures({ outbound: [], inbound: [] });
    setLoading(true);
  }, [selectedStops, departureTimeFilter]);

  // Initial fetch and auto-refresh setup
  useEffect(() => {
    fetchData();

    // Set up auto-refresh interval
    const interval = setInterval(() => {
      fetchData();
    }, API_CONFIG.refreshInterval);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [fetchData]);

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