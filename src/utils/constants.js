import { isDebugHost } from './environment';

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
  F11: { name: 'EXPRESS', icon: '🚤', color: 'bg-ferry-orange', borderColor: 'border-ferry-orange', isExpress: true },
  F1: { name: 'All-stops', icon: '🛥️', color: 'bg-ferry-aqua', borderColor: 'border-ferry-aqua', isExpress: false },
  F21: { name: 'Cross-river', icon: '⛴️', color: 'bg-gray-500', borderColor: 'border-gray-500', isExpress: false }
  // Add more ferry types as needed (e.g., CityHopper routes)
  // F4: { name: 'CityHopper', icon: '⛴️', color: 'bg-purple-500', borderColor: 'border-purple-500', isExpress: false }
};

// BRI-38: reject GTFS-RT vehicles farther than this from the nearest known
// ferry terminal — defends the live map against feed noise. 2 km accommodates
// the longest leg (Northshore Hamilton ↔ Bretts Wharf, ~3 km) with mid-leg
// margin for ferries actually in transit. Caught a non-ferry vehicle (TSN6,
// trip UNPLANNED-93822063) over Stafford Road on 2026-04-20.
export const MAX_FERRY_DISTANCE_METERS = 2000;

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

// Debug configuration — on for every host we own (localhost, Vercel preview,
// production custom domains). See isDebugHost() in utils/environment.js.
export const DEBUG_CONFIG = {
  enableLogging: (() => {
    const enabled = isDebugHost();
    if (enabled) {
      console.log(`🐛 Debug mode enabled for ${window.location.hostname}`);
    }
    return enabled;
  })()
};

// LocalStorage keys
//
// BRI-22: schedule cache is suffixed with a version tag so stale caches on
// returning users are invalidated cleanly when the cache shape changes.
// BRI-16 added `scheduledArrivalTime` to cached departures — without a
// version bump users would keep seeing the old shape until natural 24h
// expiry. Bump the suffix (`-v2` → `-v3` → ...) any time the cache shape
// changes and `cleanupLegacyStorage()` will wipe older keys on startup.
//
// User-preference keys are not versioned — their shapes haven't changed and
// wiping user preferences on a deploy would be hostile.
export const STORAGE_KEYS = {
  SCHEDULE_CACHE: 'brisbane-ferry-schedule-cache-v2',
  SELECTED_STOPS: 'brisbane-ferry-selected-stops',
  SELECTED_STOPS_SESSION: 'brisbane-ferry-selected-stops-session',
  REMEMBER_SELECTION: 'brisbane-ferry-remember-selection',
  DEPARTURE_TIME: 'brisbane-ferry-departure-time'
};

/**
 * One-time cleanup of pre-versioned schedule-cache keys. Called by main.jsx
 * on startup — idempotent, safe to keep indefinitely. Add entries here if
 * future schema bumps leave legacy keys behind.
 */
export function cleanupLegacyStorage() {
  const LEGACY_SCHEDULE_CACHE_KEYS = [
    'brisbane-ferry-schedule-cache', // v1 (pre-BRI-22)
  ];
  try {
    for (const key of LEGACY_SCHEDULE_CACHE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    // localStorage may be disabled or full; don't let it break app init.
    console.warn('[storage] legacy cleanup failed:', e);
  }
}

// Default stops for backward compatibility
export const DEFAULT_STOPS = {
  outbound: {
    id: STOPS.bulimba,
    name: 'Bulimba'
  },
  inbound: {
    id: STOPS.riverside,
    name: 'Riverside'
  }
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

// GTFS-RT VehicleStopStatus enum mappings
export const VEHICLE_STATUS = {
  0: 'Approaching stop',
  1: 'Stopped at terminal',
  2: 'In transit',
  // String mappings
  'INCOMING_AT': 'Approaching stop',
  'STOPPED_AT': 'Stopped at terminal',
  'IN_TRANSIT_TO': 'In transit'
};

// Helper function to get vehicle status display
export const getVehicleStatusInfo = (statusValue) => {
  if (statusValue === null || statusValue === undefined) return null;
  
  const text = VEHICLE_STATUS[statusValue];
  if (text) return text;
  
  // Fallback for unknown values
  return String(statusValue).replace(/_/g, ' ').toLowerCase();
};