# Phase 3: Train Mode Implementation Plan

## Overview
**Objective**: Launch BrisbaneTrain.com with real-time train tracking for all 152 Queensland Rail stations in the SEQ network.

**Duration**: 5-7 days
**Branch**: `train_mode` (from `transit_dev`)
**Domain**: brisbanetrain.com (to be registered)
**Completion Target**: End of Week 4

## Prerequisites (From Phase 2) ✅
- Mode abstraction system complete
- Serverless infrastructure ready
- Multi-mode schedule processor working
- Route allow-set filtering implemented
- Stable performance with no infinite loops

## Train Network Scope
**152 Stations across 13 lines:**
- Ferny Grove Line
- Caboolture Line
- Kippa-Ring Line (Redcliffe Peninsula)
- Sunshine Coast Line
- Shorncliffe Line
- Airport Line
- Doomben Line
- Cleveland Line
- Beenleigh Line
- Gold Coast Line
- Springfield Line
- Ipswich/Rosewood Line
- Exhibition Line (special events)

## Implementation Tasks

### Day 1: Train Configuration & Data Analysis

#### Task 1.1: Create Train Mode Configuration
**File**: `src/config/modes/train.config.js`
```javascript
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
      routeType: 2, // Trains
      routeFilter: (routeId) => {
        // Queensland Rail routes in SEQ
        // Examples: CABX, FGRO, SHORN, etc.
        return routeId && !routeId.startsWith('F'); // Exclude ferries
      },
      // Train lines with colors from Queensland Rail branding
      routeCategories: {
        'FGRO': { id: 'ferny-grove', name: 'Ferny Grove', color: '#00A651', icon: '🚂' },
        'CABO': { id: 'caboolture', name: 'Caboolture', color: '#0066CC', icon: '🚂' },
        'KIPP': { id: 'kippa-ring', name: 'Kippa-Ring', color: '#FF6600', icon: '🚂' },
        'SUNC': { id: 'sunshine-coast', name: 'Sunshine Coast', color: '#FFD700', icon: '🚂' },
        'SHOR': { id: 'shorncliffe', name: 'Shorncliffe', color: '#9370DB', icon: '🚂' },
        'AIRP': { id: 'airport', name: 'Airport', color: '#FF1493', icon: '✈️' },
        'DOOM': { id: 'doomben', name: 'Doomben', color: '#8B4513', icon: '🚂' },
        'CLEV': { id: 'cleveland', name: 'Cleveland', color: '#DC143C', icon: '🚂' },
        'BEEN': { id: 'beenleigh', name: 'Beenleigh', color: '#32CD32', icon: '🚂' },
        'GOLD': { id: 'gold-coast', name: 'Gold Coast', color: '#FFD700', icon: '🚂' },
        'SPRI': { id: 'springfield', name: 'Springfield', color: '#4B0082', icon: '🚂' },
        'IPSW': { id: 'ipswich', name: 'Ipswich/Rosewood', color: '#708090', icon: '🚂' }
      }
    },
    api: {
      endpoints: {
        tripUpdates: 'TripUpdates',
        vehiclePositions: 'VehiclePositions',
        serviceAlerts: 'Alerts'
      },
      refreshInterval: 60000, // 1 minute (trains update more frequently)
      cacheTimeout: 60000, // 1 minute cache
      staleThreshold: 120000 // 2 minutes
    },
    features: {
      showPlatforms: true,
      showLines: true,
      showAccessibility: true,
      showParkAndRide: true,
      showTicketZones: true,
      showStationFacilities: true,
      multiLineFilter: true // Can filter by multiple lines
    }
  },
  ui: {
    colors: {
      primary: '#0066CC', // Queensland Rail blue
      secondary: '#FFD700', // Gold accent
      accent: '#00A651', // Green for active
      background: '#F5F5F5',
      text: '#333333'
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
      line: 'Line',
      zone: 'Zone'
    }
  }
};
```

#### Task 1.2: Analyze Train GTFS Data
```bash
# Extract train routes and stops from GTFS
node schedule-processor/process-schedule.js --mode train --analyze

# Expected output:
# - 152 stations identified
# - ~50-100 routes (including variations)
# - Platform information in stop_name field
# - Zone information in fare data
```

### Day 2: Station Data & UI Components

#### Task 2.1: Process Train Schedule Data
```bash
# Generate train schedule with platform info
node schedule-processor/process-schedule.js --mode train

# Output: /schedule-data/train/latest.json
# Size estimate: ~3-5MB (152 stations vs 22 ferry terminals)
```

#### Task 2.2: Create Train-Specific Components

**File**: `src/components/train/PlatformIndicator.jsx`
```jsx
export function PlatformIndicator({ platform, isLive }) {
  return (
    <div className="platform-indicator">
      <span className="platform-label">Platform</span>
      <span className={`platform-number ${isLive ? 'live' : ''}`}>
        {platform || 'TBA'}
      </span>
    </div>
  );
}
```

**File**: `src/components/train/LineFilter.jsx`
```jsx
export function LineFilter({ lines, selectedLines, onToggle }) {
  return (
    <div className="line-filter">
      {lines.map(line => (
        <button
          key={line.id}
          onClick={() => onToggle(line.id)}
          className={selectedLines.includes(line.id) ? 'active' : ''}
          style={{ backgroundColor: line.color }}
        >
          {line.name}
        </button>
      ))}
    </div>
  );
}
```

### Day 3: Station Selector & Search

#### Task 3.1: Implement Station Search
With 152 stations, we need search functionality:

**File**: `src/components/train/StationSearch.jsx`
```jsx
export function StationSearch({ stations, onSelect }) {
  const [search, setSearch] = useState('');
  const [filtered, setFiltered] = useState([]);

  const popularStations = [
    'Central', 'Roma Street', 'Fortitude Valley',
    'South Bank', 'Bowen Hills', 'Eagle Junction'
  ];

  // Filter by:
  // - Station name
  // - Line name
  // - Zone
  // - Suburb
}
```

#### Task 3.2: Station Connectivity Matrix
Build connectivity data for direct connections:
- Which stations connect directly
- Transfer stations (e.g., Central, Roma Street)
- Express vs all-stops patterns

### Day 4: Platform & Real-Time Integration

#### Task 4.1: Platform Number Extraction
```javascript
// Extract platform from GTFS stop_name
// Format: "Central station, platform 1"
function extractPlatform(stopName) {
  const match = stopName.match(/platform\s+(\d+)/i);
  return match ? match[1] : null;
}
```

#### Task 4.2: Real-Time Platform Updates
```javascript
// Merge real-time platform changes
function mergeRealtimePlatform(scheduled, realtime) {
  if (realtime.stopTimeUpdate?.platform) {
    return {
      ...scheduled,
      platform: realtime.stopTimeUpdate.platform,
      platformChanged: scheduled.platform !== realtime.stopTimeUpdate.platform
    };
  }
  return scheduled;
}
```

### Day 5: Testing & Domain Setup

#### Task 5.1: End-to-End Testing
Test scenarios:
1. **Peak Hour**: Central to Airport (complex routing)
2. **Multi-Line**: Stations served by multiple lines
3. **Express Services**: Skip-stop patterns
4. **Platform Changes**: Real-time platform updates
5. **Service Alerts**: Track work notifications

#### Task 5.2: Domain Configuration
1. Register `brisbanetrain.com`
2. Configure Vercel deployment
3. Update mode detection for new domain
4. Set up analytics tracking

### Day 6: Performance & Optimization

#### Task 6.1: Data Optimization
- Implement station clustering for map view
- Lazy load distant stations
- Cache popular routes
- Compress schedule data

#### Task 6.2: Search Performance
- Build search index on deployment
- Implement fuzzy search
- Add "recent searches" with localStorage

### Day 7: Polish & Launch

#### Task 7.1: Train-Specific Features
- **Accessibility Info**: Lift/ramp availability
- **Park & Ride**: Parking availability
- **Station Facilities**: Toilets, shops, etc.
- **Journey Planner**: Multi-leg trips

#### Task 7.2: Launch Checklist
- [ ] All 152 stations loading correctly
- [ ] Platform information displaying
- [ ] Line filtering working
- [ ] Real-time updates functioning
- [ ] Domain configured and SSL working
- [ ] Analytics tracking enabled
- [ ] Error monitoring active
- [ ] Documentation updated

## Data Structure Examples

### Train Departure Object
```javascript
{
  tripId: "CABO-1234",
  routeId: "CABO",
  line: "Caboolture",
  lineColor: "#0066CC",
  origin: {
    id: "600026",
    name: "Central",
    platform: "3",
    zone: "1"
  },
  destination: {
    id: "600196",
    name: "Caboolture",
    platform: "1",
    zone: "5"
  },
  departureTime: "2025-09-16T07:30:00",
  arrivalTime: "2025-09-16T08:15:00",
  isExpress: false,
  isRealtime: true,
  delay: 2, // minutes
  platformChanged: false,
  accessibility: {
    wheelchairAccessible: true,
    audioAnnouncements: true
  },
  occupancy: "MANY_SEATS_AVAILABLE"
}
```

### Station Object
```javascript
{
  id: "600026",
  name: "Central",
  lat: -27.4659,
  lng: 153.0258,
  zone: "1",
  lines: ["CABO", "FGRO", "SHOR", "CLEV", "BEEN", "GOLD"],
  platforms: ["1", "2", "3", "4", "5", "6"],
  facilities: {
    parking: true,
    bikeRacks: true,
    toilets: true,
    ticketOffice: true,
    accessibility: {
      lifts: true,
      ramps: true,
      tactilePaving: true
    }
  },
  connections: {
    bus: true,
    ferry: false,
    tram: false
  }
}
```

## Success Metrics

| Metric | Target | Priority |
|--------|--------|----------|
| Station Load Time | <2s | High |
| Search Response | <100ms | High |
| Platform Accuracy | >95% | High |
| Line Filter Performance | <50ms | Medium |
| Data Size | <5MB | Medium |
| Mobile Usability | >90% satisfaction | High |

## Technical Considerations

### 1. Scale Differences
- **152 stations** vs 22 ferry terminals (7x more)
- **Multiple platforms** per station (up to 10 at Central)
- **Complex routing** with express patterns
- **Transfer stations** requiring connection info

### 2. UI Challenges
- **Station selection** needs search/filter
- **Platform display** requires more screen space
- **Line colors** must match Queensland Rail branding
- **Journey planning** for multi-leg trips

### 3. Data Challenges
- **Platform extraction** from GTFS stop names
- **Express patterns** need special handling
- **Service alerts** more complex than ferries
- **Track work** notifications critical

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| 152 stations overwhelming UI | High | Implement search, popular stations, zones |
| Platform data inconsistent | Medium | Fallback to "Check station boards" |
| Multiple lines confusing | Medium | Clear line colors, filtering |
| Large data size | Medium | Progressive loading, caching |
| Complex transfers | Low | Show direct services first |

## Dependencies

1. **Domain Registration**: brisbanetrain.com
2. **Queensland Rail GTFS**: Verify platform data quality
3. **Train Icons/Assets**: Line-specific colors
4. **Testing Data**: Peak/off-peak patterns

## Next Steps After Launch

1. **Monitor Performance**: Track load times with 152 stations
2. **Gather Feedback**: User testing with commuters
3. **Optimize Search**: Improve station finding
4. **Add Features**: Journey planner, service alerts
5. **Prepare Phase 4**: Bus infrastructure planning

## Implementation Checklist

### Configuration
- [ ] Create train.config.js
- [ ] Update modeDetector.js for train mode
- [ ] Configure domain detection

### Data Processing
- [ ] Run schedule processor for trains
- [ ] Verify platform extraction
- [ ] Build station connectivity matrix
- [ ] Generate line metadata

### UI Components
- [ ] PlatformIndicator component
- [ ] LineFilter component
- [ ] StationSearch component
- [ ] Multi-line display

### Testing
- [ ] Test all 152 stations
- [ ] Verify platform accuracy
- [ ] Test line filtering
- [ ] Check express patterns
- [ ] Mobile responsive testing

### Deployment
- [ ] Register domain
- [ ] Configure Vercel
- [ ] Set up analytics
- [ ] Enable monitoring
- [ ] Update documentation

## Conclusion

Phase 3 will expand the transit tracker from 22 ferry terminals to 152 train stations, requiring enhanced search, filtering, and display capabilities. The existing infrastructure from Phase 2 provides a solid foundation, but the 7x increase in stops requires careful attention to performance and usability.

The train mode will serve as a proving ground for the scalability of our architecture before tackling the 12,000+ bus stops in Phase 4-5.

---

*Created: September 16, 2025*
*Status: Ready to implement*
*Prerequisites: Phase 2 Complete ✅*