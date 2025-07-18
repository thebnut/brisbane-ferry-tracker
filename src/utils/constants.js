export const STOPS = {
  bulimba: "317584",        // Bulimba ferry terminal
  riverside: "317590",      // Riverside ferry terminal
  apolloRoad: "317533"      // Apollo Road (near Bulimba)
};

export const ROUTES = {
  expressCityCat: "F11",    // Apollo Road-Riverside express
  allStopsCityCat: "F1",    // Northshore Hamilton-UQ St Lucia
  crossRiver: "F21"         // Bulimba-Teneriffe (if needed)
};

export const SERVICE_TYPES = {
  F11: { name: 'EXPRESS', icon: '🚤', color: 'bg-golden', borderColor: 'border-golden', isExpress: true },
  F1: { name: 'All-stops', icon: '🛥️', color: 'bg-ferry-blue', borderColor: 'border-ferry-blue', isExpress: false },
  F21: { name: 'Cross-river', icon: '⛴️', color: 'bg-gray-500', borderColor: 'border-gray-500', isExpress: false }
};

export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_GTFS_API_BASE || 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/',
  endpoints: {
    tripUpdates: 'TripUpdates',
    vehiclePositions: 'VehiclePositions',
    serviceAlerts: 'Alerts'
  },
  refreshInterval: 5 * 60 * 1000, // 5 minutes
  timezone: 'Australia/Brisbane'
};

// Debug configuration
export const DEBUG_CONFIG = {
  enableLogging: false // Set to true to enable debug logging
};

// GTFS-RT OccupancyStatus enum mappings
export const OCCUPANCY_STATUS = {
  0: { text: 'Empty', icon: '⚪', color: 'gray' },
  1: { text: 'Many seats', icon: '🟢', color: 'green' },
  2: { text: 'Few seats', icon: '🟡', color: 'yellow' },
  3: { text: 'Standing room', icon: '🟠', color: 'orange' },
  4: { text: 'Very full', icon: '🔴', color: 'red' },
  5: { text: 'Full', icon: '🔴', color: 'red' },
  6: { text: 'Not accepting passengers', icon: '⛔', color: 'red' },
  // String mappings
  'EMPTY': { text: 'Empty', icon: '⚪', color: 'gray' },
  'MANY_SEATS_AVAILABLE': { text: 'Many seats', icon: '🟢', color: 'green' },
  'FEW_SEATS_AVAILABLE': { text: 'Few seats', icon: '🟡', color: 'yellow' },
  'STANDING_ROOM_ONLY': { text: 'Standing room', icon: '🟠', color: 'orange' },
  'CRUSHED_STANDING_ROOM_ONLY': { text: 'Very full', icon: '🔴', color: 'red' },
  'FULL': { text: 'Full', icon: '🔴', color: 'red' },
  'NOT_ACCEPTING_PASSENGERS': { text: 'Not accepting passengers', icon: '⛔', color: 'red' }
};

// Helper function to get occupancy display info
export const getOccupancyInfo = (occupancyValue) => {
  if (occupancyValue === null || occupancyValue === undefined) return null;
  
  const info = OCCUPANCY_STATUS[occupancyValue];
  if (info) return info;
  
  // Fallback for unknown values
  return { 
    text: String(occupancyValue).replace(/_/g, ' ').toLowerCase(), 
    icon: '❓', 
    color: 'gray' 
  };
};