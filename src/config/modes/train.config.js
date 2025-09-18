const TRAIN_STOPS = [
  { id: '600016', name: 'Central station, platform 3', lat: -27.4659, lng: 153.0258 },
  { id: '600001', name: 'Roma Street station, platform 4', lat: -27.4674, lng: 153.0206 },
  { id: '600002', name: 'Fortitude Valley station, platform 2', lat: -27.4558, lng: 153.0353 },
  { id: '600012', name: 'South Bank station, platform 1', lat: -27.4757, lng: 153.0214 },
  { id: '600014', name: 'South Brisbane station, platform 1', lat: -27.4802, lng: 153.0179 }
];

export const TRAIN_CONFIG = {
  mode: {
    id: 'train',
    name: 'Brisbane Train Tracker',
    shortName: 'Train',
    domain: 'brisbanetrain.com',
    analyticsId: import.meta.env.VITE_GA_TRAIN || ''
  },

  branding: {
    logo: null,
    alt: 'Brisbane Train Tracker',
    height: 'h-16 md:h-28'
  },

  data: {
    gtfs: {
      routeType: 2,
      routeFilter: (routeId) => routeId && !routeId.startsWith('F'),
      routeCategories: {}
    },
    api: {
      refreshInterval: 120000, // 2 minutes
      cacheTimeout: 600000, // 10 minutes
      staleThreshold: 120000
    },
    stops: {
      list: TRAIN_STOPS,
      defaults: {
        origin: '600016',
        destination: '600001'
      }
    }
  },

  features: {
    liveMap: false,
    vehicleTracking: false,
    occupancy: false,
    platforms: true,
    serviceFilters: true,
    nearestStop: true,
    routeSearch: true,
    accessibility: true,
    departureTime: true,
    feedback: true
  },

  ui: {
    stopSelection: {
      method: 'dropdown',
      showMap: false,
      maxResults: 300
    },
    departures: {
      defaultCount: 5,
      expandedCount: 10,
      groupByRoute: false,
      showJourneyTime: true,
      timeFormat: 'relative',
      timeWindow: 12
    },
    labels: {
      stop: 'station',
      stops: 'stations',
      vehicle: 'train',
      vehicles: 'trains',
      selectStops: 'Select Train Stations'
    }
  },

  services: {
    filters: [
      {
        id: 'all',
        label: 'All services',
        predicate: () => true
      }
    ]
  }
};

export default TRAIN_CONFIG;
