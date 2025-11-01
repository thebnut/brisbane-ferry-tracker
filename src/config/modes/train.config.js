import trainStationsData from '../../data/trainStations.json';

// Helper function to convert station name to slug
function toStationSlug(stationName) {
  return stationName
    .replace(/\s+station$/i, '') // Remove " station" suffix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/^_|_$/g, ''); // Trim leading/trailing underscores
}

// Train-specific configuration
export const TRAIN_CONFIG = {
  // Core Identity
  mode: {
    id: 'train',
    name: 'Brisbane Train Tracker',
    shortName: 'Train',
    domain: 'brisbanetrain.com',
    analyticsId: import.meta.env.VITE_GA_TRAIN || ''
  },

  // Visual Identity
  branding: {
    logo: {
      src: '/brisbane_train_logo.png',
      alt: 'Brisbane Train Tracker',
      height: 'h-16 md:h-28'
    },
    favicon: '/train-favicon.ico',
    theme: {
      primary: 'blue-600',
      secondary: 'blue-800',
      accent: 'blue-400'
    },
    icons: {
      mode: '🚆',
      express: '🚄',
      standard: '🚆'
    }
  },

  // Data Configuration
  data: {
    gtfs: {
      routeType: 2, // GTFS route_type for trains
      staticSchedule: true // No real-time tracking yet (Phase 4)
    },
    api: {
      baseUrl: '/api/schedule/train',
      endpoint: '/route',
      refreshInterval: 300000,  // 5 minutes
      cacheTimeout: 86400000,   // 24 hours
      staleThreshold: 600000    // 10 minutes
    },
    stops: {
      // Use imported train stations data with station slugs as IDs
      list: trainStationsData.map(station => ({
        id: toStationSlug(station.name), // Use station slug as ID
        name: station.name,
        stopIds: station.stopIds // All platform IDs for this station (for reference only)
      })),
      defaults: {
        origin: 'BOWEN_HILLS',      // Bowen Hills station slug
        destination: 'FORTITUDE_VALLEY' // Fortitude Valley station slug
      }
    }
  },

  // Feature Flags
  features: {
    liveMap: false,          // No real-time tracking (Phase 4)
    vehicleTracking: false,  // Phase 4
    occupancy: false,
    platforms: true,         // Show platform numbers
    headsigns: true,         // Show route destinations
    serviceFilters: false,   // No Express/All Stops filtering yet
    nearestStop: false,
    routeSearch: false,
    accessibility: false,
    departureTime: true,
    feedback: true,
    vesselNames: false
  },

  // UI Configuration
  ui: {
    stopSelection: {
      method: 'dropdown', // Dropdown only (no map for trains yet)
      showMap: false,
      maxResults: 154 // All 154 stations
    },
    departures: {
      defaultCount: 5,
      expandedCount: 13,
      groupByRoute: false,
      showJourneyTime: true,
      showPlatform: true,      // NEW: Show platform numbers
      showHeadsign: true,      // NEW: Show where train is going
      timeFormat: 'relative',
      timeWindow: 24 // hours
    },
    labels: {
      stop: 'station',
      stops: 'stations',
      vehicle: 'train',
      vehicles: 'trains',
      platform: 'Platform',
      selectStops: 'Select Train Stations',
      fromLabel: 'From (Origin Station)',
      toLabel: 'To (Destination Station)',
      noStopsSuffix: false // Keep full "station" in names
    }
  },

  // Service Filters (disabled for now)
  services: {
    filters: [
      {
        id: 'all',
        label: 'All Trains',
        icon: null,
        predicate: () => true
      }
    ]
  },

  // Map Configuration (disabled for Phase 3)
  map: {
    center: {
      lat: -27.4678,
      lng: 153.0281
    },
    zoom: 12,
    maxBounds: [
      [-27.7, 152.8],  // Southwest
      [-27.2, 153.3]   // Northeast
    ],
    style: 'CartoDB.Positron',
    showStopMarkers: false, // Disabled for now
    showVehicleMarkers: false, // Phase 4
    vehicleRefreshInterval: 300000
  },

  // Messages and Text
  messages: {
    loading: 'Loading train times...',
    noService: 'No trains currently running',
    error: 'Unable to load train information',
    staleData: 'Showing cached train times',
    selectStops: 'Please select your train stations',
    noDirectService: 'No direct train service between these stations'
  }
};
