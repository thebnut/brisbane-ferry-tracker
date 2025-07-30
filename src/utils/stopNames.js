import staticGtfsService from '../services/staticGtfsService';
import { FERRY_STOPS } from './ferryStops';

// Cache for CSV data
let csvStopData = null;

// Load and parse CSV data
const loadCSVData = async () => {
  if (csvStopData) return csvStopData;
  
  try {
    const response = await fetch('/Ordered_Brisbane_Ferry_Terminals.csv');
    const text = await response.text();
    const lines = text.split('\n');
    const stops = {};
    
    // Parse CSV (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const [stopId, name] = line.split(',');
      if (stopId && name) {
        stops[stopId.trim()] = name.trim();
      }
    }
    
    csvStopData = stops;
    return stops;
  } catch (error) {
    console.warn('Failed to load CSV stop data:', error);
    csvStopData = {}; // Set empty object to prevent repeated attempts
    return {};
  }
};

// Get stop name with multiple fallbacks
export const getStopName = async (stopId) => {
  if (!stopId) return 'Unknown Stop';
  
  // Try dynamic service first (most up-to-date)
  const stopInfo = staticGtfsService.getStopInfo(stopId);
  if (stopInfo?.name) {
    return stopInfo.name.replace(' ferry terminal', '');
  }
  
  // Try CSV data (complete backup)
  if (!csvStopData) {
    await loadCSVData();
  }
  if (csvStopData && csvStopData[stopId]) {
    return csvStopData[stopId].replace(' ferry terminal', '');
  }
  
  // Fall back to hardcoded data
  const hardcodedName = FERRY_STOPS[stopId]?.name;
  if (hardcodedName) {
    return hardcodedName.replace(' ferry terminal', '');
  }
  
  // Last resort
  return `Stop ${stopId}`;
};

// Synchronous version for immediate use (uses cached data only)
export const getStopNameSync = (stopId) => {
  if (!stopId) return 'Unknown Stop';
  
  // Try dynamic service first
  const stopInfo = staticGtfsService.getStopInfo(stopId);
  if (stopInfo?.name) {
    return stopInfo.name.replace(' ferry terminal', '');
  }
  
  // Try CSV data if already loaded
  if (csvStopData && csvStopData[stopId]) {
    return csvStopData[stopId].replace(' ferry terminal', '');
  }
  
  // Fall back to hardcoded data
  const hardcodedName = FERRY_STOPS[stopId]?.name;
  if (hardcodedName) {
    return hardcodedName.replace(' ferry terminal', '');
  }
  
  return `Stop ${stopId}`;
};

// Preload CSV data (call this early in app lifecycle)
export const preloadStopData = () => {
  return loadCSVData();
};