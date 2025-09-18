import { FERRY_STOPS } from '../../utils/ferryStops';

// Ferry-specific configuration
export const FERRY_CONFIG = {
  // Core Identity
  mode: {
    id: 'ferry',
    name: 'Brisbane Ferry Tracker',
    shortName: 'Ferry',
    domain: 'brisbaneferry.com',
    analyticsId: import.meta.env.VITE_GA_FERRY || ''
  },

  // Visual Identity
  branding: {
    logo: {
      src: '/bf.com_logo_text.png',
      alt: 'Brisbane Ferry Tracker',
      height: 'h-16 md:h-28'
    },
    favicon: '/bf_favicon.png',
    theme: {
      primary: 'ferry-orange',
      secondary: 'ferry-blue',
      accent: 'ferry-aqua'
    },
    icons: {
      mode: '🛥️',
      express: '🚤',
      standard: '🛥️',
      crossRiver: '⛴️'
    }
  },

  // Data Configuration
  data: {
    gtfs: {
      routeType: 4, // GTFS route_type for ferry
      routeFilter: (routeId) => routeId && routeId.startsWith('F'),
      routeCategories: {
        'F11': {
          id: 'express',
          name: 'EXPRESS',
          icon: '🚤',
          color: 'bg-ferry-orange',
          borderColor: 'border-ferry-orange',
          isExpress: true,
          priority: 1
        },
        'F1': {
          id: 'standard',
          name: 'All-stops',
          icon: '🛥️',
          color: 'bg-ferry-aqua',
          borderColor: 'border-ferry-aqua',
          isExpress: false,
          priority: 2
        },
        'F21': {
          id: 'crossRiver',
          name: 'Cross-river',
          icon: '⛴️',
          color: 'bg-gray-500',
          borderColor: 'border-gray-500',
          isExpress: false,
          priority: 3
        },
        'F4': {
          id: 'cityHopper',
          name: 'CityHopper',
          icon: '⛴️',
          color: 'bg-purple-500',
          borderColor: 'border-purple-500',
          isExpress: false,
          priority: 3
        },
        'F5': {
          id: 'cityDog',
          name: 'CityDog',
          icon: '🛥️',
          color: 'bg-ferry-aqua',
          borderColor: 'border-ferry-aqua',
          isExpress: false,
          priority: 3
        }
      }
    },
    api: {
      scheduleUrl: 'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/latest.json',
      fallbackScheduleUrl: '/schedule-data/latest.json',
      refreshInterval: 300000,  // 5 minutes
      cacheTimeout: 86400000,   // 24 hours
      staleThreshold: 600000    // 10 minutes
    },
    stops: {
      // Use imported ferry stops data
      list: Object.entries(FERRY_STOPS).map(([id, stop]) => ({
        id,
        ...stop
      })),
      defaults: {
        origin: '317584',   // Bulimba
        destination: '317590' // Riverside
      },
      // Connectivity will be loaded from schedule data
      connectivity: {}
    }
  },

  // Feature Flags
  features: {
    liveMap: true,
    vehicleTracking: true,
    occupancy: true,
    platforms: false,
    serviceFilters: true,
    nearestStop: true,
    routeSearch: false,
    accessibility: false,
    departureTime: true,
    feedback: true,
    vesselNames: true
  },

  // UI Configuration
  ui: {
    stopSelection: {
      method: 'hybrid', // dropdown + map
      showMap: true,
      maxResults: 50
    },
    departures: {
      defaultCount: 5,
      expandedCount: 13,
      groupByRoute: false,
      showJourneyTime: true,
      timeFormat: 'relative',
      timeWindow: 24 // hours
    },
    labels: {
      stop: 'terminal',
      stops: 'terminals',
      vehicle: 'ferry',
      vehicles: 'ferries',
      selectStops: 'Select Ferry Stops',
      fromLabel: 'From (Origin Terminal)',
      toLabel: 'To (Destination Terminal)',
      noStopsSuffix: true // Remove "ferry terminal" suffix from names
    }
  },

  // Service Filters
  services: {
    filters: [
      {
        id: 'all',
        label: 'All Services',
        icon: null,
        predicate: () => true
      },
      {
        id: 'express',
        label: 'Express only',
        icon: '🚤',
        predicate: (departure) => {
          const routeId = departure?.routeId;
          return routeId === 'F11' || routeId?.startsWith('F11');
        }
      }
    ]
  },

  // Map Configuration
  map: {
    center: {
      lat: -27.4705,
      lng: 153.0260
    },
    zoom: 13,
    maxBounds: [
      [-27.6, 152.9],  // Southwest
      [-27.3, 153.2]   // Northeast
    ],
    style: 'CartoDB.Positron',
    showStopMarkers: true,
    showVehicleMarkers: true,
    vehicleRefreshInterval: 300000 // 5 minutes
  },

  // Messages and Text
  messages: {
    loading: 'Loading ferry times...',
    noService: 'No ferries currently running',
    error: 'Unable to load ferry information',
    staleData: 'Showing cached ferry times',
    selectStops: 'Please select your ferry terminals',
    noDirectService: 'No direct ferry service between these terminals'
  }
};
