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

  // Ferry mode - use existing hook
  const ferryData = useFerryData(
    selectedStops,
    departureTimeFilter
  );

  // Train mode - use train hook with origin/destination
  const trainData = useTrainData(
    selectedStops?.outbound?.id,
    selectedStops?.inbound?.id,
    4 // 4 hours window
  );

  // Return appropriate data based on mode
  if (modeId === 'train') {
    // Transform train data to match ferry data structure
    return {
      departures: {
        outbound: trainData.data?.departures || [],
        inbound: [] // Train mode doesn't have inbound
      },
      vehiclePositions: [],
      tripUpdates: [],
      loading: trainData.loading,
      scheduleLoading: false,
      error: trainData.error,
      lastUpdated: trainData.lastUpdated,
      refresh: trainData.refresh,
      exportDebugData: () => {
        console.log('Train mode debug:', trainData.data);
      }
    };
  }

  // Ferry mode - return as-is
  return ferryData;
};

export default useTransitData;
