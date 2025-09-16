// Train Mode Configuration for Brisbane Train Tracker
// Covers all 152 Queensland Rail stations in SEQ network

export const TRAIN_CONFIG = {
  mode: {
    id: 'train',
    name: 'Brisbane Train Tracker',
    shortName: 'TrainTracker',
    domain: 'brisbanetrain.com',
    analyticsId: import.meta.env.VITE_GA_TRAIN || ''
  },
  data: {
    gtfs: {
      routeType: 2, // GTFS route_type 2 = Rail/Train
      routeFilter: (route) => {
        // Filter for Queensland Rail train routes
        // Route type 2 and not ferry routes
        return parseInt(route.route_type) === 2;
      },
      // Queensland Rail train lines with official colors
      // Route IDs from GTFS data will be mapped to these categories
      routeCategories: {
        'FGRO': {
          id: 'ferny-grove',
          name: 'Ferny Grove',
          color: '#00A651',
          borderColor: 'border-green-600',
          icon: '🚂',
          priority: 1
        },
        'CABO': {
          id: 'caboolture',
          name: 'Caboolture',
          color: '#0066CC',
          borderColor: 'border-blue-600',
          icon: '🚂',
          priority: 2
        },
        'KIPP': {
          id: 'kippa-ring',
          name: 'Kippa-Ring',
          color: '#FF6600',
          borderColor: 'border-orange-600',
          icon: '🚂',
          priority: 3
        },
        'SUNC': {
          id: 'sunshine-coast',
          name: 'Sunshine Coast',
          color: '#FFD700',
          borderColor: 'border-yellow-500',
          icon: '🚂',
          priority: 4
        },
        'SHOR': {
          id: 'shorncliffe',
          name: 'Shorncliffe',
          color: '#9370DB',
          borderColor: 'border-purple-600',
          icon: '🚂',
          priority: 5
        },
        'AIRP': {
          id: 'airport',
          name: 'Airport',
          color: '#FF1493',
          borderColor: 'border-pink-600',
          icon: '✈️',
          priority: 6
        },
        'DOOM': {
          id: 'doomben',
          name: 'Doomben',
          color: '#8B4513',
          borderColor: 'border-amber-700',
          icon: '🚂',
          priority: 7
        },
        'CLEV': {
          id: 'cleveland',
          name: 'Cleveland',
          color: '#DC143C',
          borderColor: 'border-red-600',
          icon: '🚂',
          priority: 8
        },
        'BEEN': {
          id: 'beenleigh',
          name: 'Beenleigh',
          color: '#32CD32',
          borderColor: 'border-lime-500',
          icon: '🚂',
          priority: 9
        },
        'GOLD': {
          id: 'gold-coast',
          name: 'Gold Coast',
          color: '#FFD700',
          borderColor: 'border-yellow-400',
          icon: '🚂',
          priority: 10
        },
        'SPRI': {
          id: 'springfield',
          name: 'Springfield',
          color: '#4B0082',
          borderColor: 'border-indigo-700',
          icon: '🚂',
          priority: 11
        },
        'IPSW': {
          id: 'ipswich',
          name: 'Ipswich/Rosewood',
          color: '#708090',
          borderColor: 'border-gray-600',
          icon: '🚂',
          priority: 12
        },
        'EXHI': {
          id: 'exhibition',
          name: 'Exhibition',
          color: '#FF69B4',
          borderColor: 'border-pink-500',
          icon: '🎪',
          priority: 13,
          special: true // Special event line
        }
      }
    },
    api: {
      baseUrl: import.meta.env.VITE_GTFS_BASE_URL || 'https://gtfsrt.api.translink.com.au/api/realtime',
      endpoints: {
        tripUpdates: 'TripUpdates',
        vehiclePositions: 'VehiclePositions',
        serviceAlerts: 'Alerts'
      },
      proxyEndpoint: '/api/gtfs-proxy',
      staticEndpoint: '/api/gtfs-static',
      scheduleUrl: 'https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/train/latest.json',
      fallbackScheduleUrl: '/schedule-data/train/latest.json',
      refreshInterval: 60000,  // 1 minute (trains update more frequently than ferries)
      cacheTimeout: 60000,     // 1 minute cache
      staleThreshold: 120000   // 2 minutes
    },
    features: {
      showMap: true,
      showLivePositions: true,
      showScheduled: true,
      showOccupancy: true,
      showDelays: true,
      showPlatforms: true,        // NEW: Show platform numbers
      showLines: true,             // NEW: Show train lines
      showAccessibility: true,     // NEW: Wheelchair access info
      showParkAndRide: true,       // NEW: Parking availability
      showTicketZones: true,       // NEW: Fare zones
      showStationFacilities: true, // NEW: Station amenities
      multiLineFilter: true,       // NEW: Filter by multiple lines
      stationSearch: true,         // NEW: Search with 152 stations
      showTransfers: true,         // NEW: Connection information
      journeyPlanner: false        // Future: Multi-leg trips
    },
    defaultStops: {
      outbound: {
        id: '600026',  // Central station
        name: 'Central'
      },
      inbound: {
        id: '600001',  // Roma Street station
        name: 'Roma Street'
      }
    }
  },
  ui: {
    colors: {
      primary: '#0066CC',      // Queensland Rail blue
      secondary: '#FFD700',    // Gold accent
      accent: '#00A651',       // Green for active/live
      background: '#FFFFFF',
      surface: '#F5F5F5',
      text: '#333333',
      textLight: '#666666',
      success: '#00A651',
      warning: '#FF6600',
      error: '#DC143C',
      live: '#00A651',
      scheduled: '#666666'
    },
    labels: {
      vehicleType: 'Train',
      vehicleTypePlural: 'Trains',
      stopType: 'Station',
      stopTypePlural: 'Stations',
      selectOrigin: 'Select Origin Station',
      selectDestination: 'Select Destination Station',
      noService: 'No trains scheduled',
      nextService: 'Next train',
      platform: 'Platform',
      platformShort: 'Plat',
      line: 'Line',
      lines: 'Lines',
      zone: 'Zone',
      zones: 'Zones',
      allLines: 'All Lines',
      expressService: 'Express',
      allStopsService: 'All Stops',
      wheelchair: 'Wheelchair Accessible',
      parking: 'Park & Ride',
      connecting: 'Connecting Services',
      transfer: 'Transfer Station'
    },
    map: {
      defaultCenter: [-27.4698, 153.0251], // Brisbane CBD
      defaultZoom: 11,
      minZoom: 9,
      maxZoom: 18,
      clusterStations: true,  // Group nearby stations at low zoom
      showLineColors: true,   // Color code by train line
      animateTrains: true
    },
    branding: {
      logo: '/assets/train-logo.png',
      favicon: '/train_favicon.png',
      tagline: 'Real-time train departures for SEQ',
      description: 'Track Queensland Rail trains across all 152 stations in South East Queensland'
    }
  },
  // Popular stations for quick selection
  popularStations: [
    { id: '600026', name: 'Central', zone: '1' },
    { id: '600001', name: 'Roma Street', zone: '1' },
    { id: '600002', name: 'Fortitude Valley', zone: '1' },
    { id: '600012', name: 'South Bank', zone: '1' },
    { id: '600014', name: 'South Brisbane', zone: '1' },
    { id: '600059', name: 'Bowen Hills', zone: '1' },
    { id: '600060', name: 'Eagle Junction', zone: '2' },
    { id: '600043', name: 'Toowong', zone: '2' },
    { id: '600050', name: 'Indooroopilly', zone: '3' },
    { id: '600232', name: 'Chermside', zone: '3' },
    { id: '600072', name: 'Nundah', zone: '2' },
    { id: '600210', name: 'Airport Domestic', zone: 'AirTrain' }
  ],
  // Major interchange stations
  interchangeStations: [
    'Central',
    'Roma Street',
    'Fortitude Valley',
    'Bowen Hills',
    'Eagle Junction',
    'Park Road',
    'South Bank',
    'South Brisbane'
  ]
};

// Helper function to determine if a route is express
export function isExpressService(tripHeadsign) {
  const expressKeywords = ['express', 'limited stops', 'via CRR'];
  return expressKeywords.some(keyword =>
    tripHeadsign?.toLowerCase().includes(keyword)
  );
}

// Helper function to extract platform number
export function extractPlatform(stopName) {
  // Format: "Central station, platform 1" or "Roma Street platform 10"
  const match = stopName?.match(/platform\s+(\d+)/i);
  return match ? match[1] : null;
}

// Helper function to get line color
export function getLineColor(routeId) {
  // Map route ID to line category
  const linePrefix = routeId?.substring(0, 4).toUpperCase();
  const category = TRAIN_CONFIG.data.gtfs.routeCategories[linePrefix];
  return category?.color || '#708090'; // Default gray
}

// Helper function to get zone from stop
export function getZone(stopId, stopName) {
  // Zone information might be in stop_desc or need separate mapping
  // For now, return based on popular stations
  const popularStation = TRAIN_CONFIG.popularStations.find(s => s.id === stopId);
  return popularStation?.zone || 'Unknown';
}

export default TRAIN_CONFIG;