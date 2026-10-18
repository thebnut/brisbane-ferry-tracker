import { useState, useEffect, useCallback } from 'react';
import gtfsService from '../services/gtfsService';
import ferryDataService from '../services/ferryData';
import { buildSnapshot } from '../services/widgetSnapshot';
import { writeWidgetSnapshot } from '../plugins/widgetBridge';
import { API_CONFIG, DEFAULT_STOPS } from '../utils/constants';
import { getFerryDataSource, DATA_SOURCES } from '../utils/dataSource';
import { getV1FerryData } from '../services/v1FerryData';

const useFerryData = (selectedStops = DEFAULT_STOPS, departureTimeFilter = null) => {
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

      // Set selected stops and departure time filter in the service
      ferryDataService.setSelectedStops(selectedStops);
      ferryDataService.setDepartureTimeFilter(departureTimeFilter);

      // Phase 2 prep: /v1 behind a flag that defaults off (utils/dataSource.js).
      // /v1 returns the next departures from now, so a chosen departure time
      // stays on the legacy path. Any failure falls through to the legacy path
      // for this refresh, so the flag can never blank the board.
      if (getFerryDataSource() === DATA_SOURCES.v1 && !departureTimeFilter) {
        try {
          const v1 = await getV1FerryData(selectedStops, departureTimeFilter);
          setRawGtfsData({ tripUpdates: [], vehiclePositions: v1.vehiclePositions });
          setDepartures(v1.departures);
          setLastUpdated(new Date());
          setLoading(false);
          setScheduleLoading(false);
          writeWidgetSnapshot(buildSnapshot(v1.departures, selectedStops, new Date()));
          return;
        } catch (err) {
          console.warn('[dataSource] /v1 failed, using the legacy path for this refresh:', err);
        }
      }

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

      // BRI-29: push first-pass realtime data to the iOS widget as soon as
      // it's available, so the home-screen reflects fresh times the moment
      // the app is opened. Fire-and-forget; no-op on non-native runtimes.
      // The merged-pass write below usually produces an identical payload
      // for the next 3 departures; widgetBridge.js dedupes so iOS only
      // reloads the widget timeline once per refresh in the common case.
      writeWidgetSnapshot(buildSnapshot(realtimeDepartures, selectedStops, new Date()));

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

        // BRI-29: second widget write with the authoritative merged data.
        // Deduped against the realtime-pass write above — only hits iOS if
        // the serialised snapshot actually changed.
        writeWidgetSnapshot(buildSnapshot(mergedDepartures, selectedStops, new Date()));
      }).catch(err => {
        console.error('Error loading schedule data:', err);
        setScheduleLoading(false);
        // Continue showing real-time data even if schedule fails
      });
      
      setError(null);
    } catch (err) {
      console.error('Error fetching ferry data:', err);
      setError(err.message || 'Failed to load ferry times');
      // Keep whatever departures are already in state (possibly empty) so a
      // failed refresh doesn't blank out the board.
      setLoading(false);
      setScheduleLoading(false);
    }
  }, [selectedStops, departureTimeFilter]);

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