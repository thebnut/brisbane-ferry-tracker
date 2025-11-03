import { useMode } from '../config';
import useFerryData from './useFerryData';
import useTrainData from './useTrainData';

/**
 * Universal Transit Data Hook
 *
 * Automatically switches between ferry and train data hooks based on mode
 * Normalizes data structure for consistent UI rendering
 */
const useTransitData = (selectedStops, departureTimeFilter = null) => {
  const mode = useMode();
  const modeId = mode?.mode?.id || 'ferry';

  // Only call the hook for the active mode to avoid unnecessary API calls
  // For ferry mode, pass selectedStops; for train mode, pass null to skip
  const ferryData = useFerryData(
    modeId === 'ferry' ? selectedStops : null,
    modeId === 'ferry' ? departureTimeFilter : null
  );

  // For train mode, call useTrainData TWICE - once for each direction
  // Outbound: origin → destination (e.g., Morningside → Roma Street)
  const trainDataOutbound = useTrainData(
    modeId === 'train' ? selectedStops?.outbound?.id : null,
    modeId === 'train' ? selectedStops?.inbound?.id : null,
    4, // 4 hours window
    modeId === 'train' ? departureTimeFilter : null // Departure time filter
  );

  // Inbound: destination → origin (e.g., Roma Street → Morningside)
  const trainDataInbound = useTrainData(
    modeId === 'train' ? selectedStops?.inbound?.id : null,
    modeId === 'train' ? selectedStops?.outbound?.id : null,
    4, // 4 hours window
    modeId === 'train' ? departureTimeFilter : null // Departure time filter
  );

  // Return appropriate data based on mode
  if (modeId === 'train') {
    // Transform train data to match ferry data structure
    return {
      departures: {
        outbound: trainDataOutbound.data?.departures || [],
        inbound: trainDataInbound.data?.departures || []
      },
      vehiclePositions: [],
      tripUpdates: [],
      loading: trainDataOutbound.loading || trainDataInbound.loading,
      scheduleLoading: false,
      error: trainDataOutbound.error || trainDataInbound.error,
      lastUpdated: trainDataOutbound.lastUpdated || trainDataInbound.lastUpdated,
      refresh: () => {
        trainDataOutbound.refresh();
        trainDataInbound.refresh();
      },
      exportDebugData: () => {
        console.log('Train mode debug (outbound):', trainDataOutbound.data);
        console.log('Train mode debug (inbound):', trainDataInbound.data);
      }
    };
  }

  // Ferry mode - return as-is
  return ferryData;
};

export default useTransitData;
