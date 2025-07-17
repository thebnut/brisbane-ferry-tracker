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