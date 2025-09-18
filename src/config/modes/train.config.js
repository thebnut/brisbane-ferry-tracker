const TRAIN_STOPS = [
  { id: '600016', name: 'Central station, platform 3', lat: -27.4659, lng: 153.0258 },
  { id: '600001', name: 'Roma Street station, platform 4', lat: -27.4674, lng: 153.0206 },
  { id: '600002', name: 'Fortitude Valley station, platform 2', lat: -27.4558, lng: 153.0353 },
  { id: '600012', name: 'South Bank station, platform 1', lat: -27.4757, lng: 153.0214 },
  { id: '600014', name: 'South Brisbane station, platform 1', lat: -27.4802, lng: 153.0179 }
];

const TRAIN_LINES = {
  BDBR: { name: 'Airport', color: '#FFD200', icon: '✈️' },
  BDVL: { name: 'Beenleigh', color: '#FF6F00', icon: '🚆' },
  BNBN: { name: 'Beenleigh (Alt)', color: '#FB8C00', icon: '🚆' },
  CABR: { name: 'Caboolture', color: '#1565C0', icon: '🚆' },
  CLVD: { name: 'Cleveland', color: '#C62828', icon: '🚆' },
  DPIN: { name: 'Doomben', color: '#6A1B9A', icon: '🚆' },
  FGTN: { name: 'Ferny Grove', color: '#2E7D32', icon: '🚆' },
  IPSW: { name: 'Ipswich / Rosewood', color: '#37474F', icon: '🚆' },
  RDCF: { name: 'Redcliffe', color: '#D81B60', icon: '🚆' },
  SHLG: { name: 'Shorncliffe', color: '#039BE5', icon: '🚆' },
  SPWD: { name: 'Springfield', color: '#7CB342', icon: '🚆' },
  GLEN: { name: 'Gold Coast', color: '#FFA000', icon: '🌴' }
};

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
    height: 'h-16 md:h-28',
    icon: '🚆'
  },

  data: {
    gtfs: {
      routeType: 2,
      routeFilter: (routeId) => routeId && !routeId.startsWith('F'),
      routeCategories: TRAIN_LINES
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
        label: 'All lines',
        predicate: () => true
      },
      ...Object.entries(TRAIN_LINES).map(([prefix, meta]) => ({
        id: `line-${prefix}`,
        label: meta.name,
        color: meta.color,
        icon: meta.icon,
        predicate: (departure) => departure?.routeId?.startsWith(prefix)
      }))
    ]
  }
};

export default TRAIN_CONFIG;
