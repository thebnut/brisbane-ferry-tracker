# Brisbane Ferry Tracker - Application Architecture

## Overview

This document describes the data flow and architecture of the Brisbane Ferry Tracker application, showing how data moves from TransLink's APIs through processing steps to the final user interface.

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           BRISBANE FERRY TRACKER DATA FLOW                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

DATA SOURCES                          PROCESSING                         FRONTEND
────────────                          ──────────                         ────────

┌─────────────────────┐
│   TransLink GTFS    │
│  (Static Schedule)  │               ┌──────────────────────┐
│                     │               │  GitHub Actions      │
│ SEQ_GTFS.zip (30MB) │──────────────►│  (Daily @ 3AM)      │
│ - routes.txt        │               │                      │
│ - trips.txt         │               │ schedule-processor/  │
│ - stop_times.txt    │               │ process-schedule.js  │
│ - stops.txt         │               └──────────┬───────────┘
│ - calendar.txt      │                          │
└─────────────────────┘                          │ Generates
                                                 ▼
                                    ┌─────────────────────────┐
                                    │   GitHub Pages CDN      │
                                    │                         │
                                    │ schedule-data/          │
                                    │   latest.json (3MB)     │
                                    │                         │
                                    │ - All ferry departures  │
                                    │ - Ferry stops list      │
                                    │ - Stop connectivity     │
                                    │ - Generated timestamp   │
                                    └──────────┬──────────────┘
                                               │
┌─────────────────────┐                        │
│  TransLink GTFS-RT  │                        │
│   (Live Updates)    │                        │
│                     │                        │
│ /TripUpdates        │                        │         ┌─────────────────────┐
│ - Real-time delays  │                        │         │   React App         │
│ - Live departures   │                        │         │                     │
│                     │                        ▼         │  ┌───────────────┐  │
│ /VehiclePositions   │         ┌──────────────────────┐ │  │ App.jsx       │  │
│ - GPS coordinates   │         │  staticGtfsService   │ │  │               │  │
│ - Occupancy status  │         │                      │ │  │ - Selected    │  │
└──────────┬──────────┘         │ 1. Check cache       │ │  │   stops state │  │
           │                    │ 2. Validate against  │ │  │               │  │
           │                    │    GitHub timestamp  │ │  └───────┬───────┘  │
           │                    │ 3. Update if newer   │ │          │          │
           │                    │ 4. Parse ferry stops │ │          ▼          │
           │                    └──────────┬───────────┘ │  ┌───────────────┐  │
           │                               │             │  │useFerryData   │  │
           │                               │             │  │   Hook        │  │
           ▼                               ▼             │  │               │  │
    ┌─────────────────┐         ┌─────────────────────┐ │  │1. Load RT     │  │
    │ Vercel Proxy    │         │   ferryData.js      │ │  │2. Load sched  │  │
    │ /api/gtfs-proxy │────────►│                     │ │  │3. Merge data  │  │
    │                 │         │ 1. Filter trips     │ │  └───────┬───────┘  │
    │ (CORS handling) │         │ 2. Check sequences  │ │          │          │
    └─────────────────┘         │ 3. Merge RT+sched  │ │          ▼          │
                               │ 4. Group by dir     │ │  ┌───────────────┐  │
                               └─────────┬───────────┘ │  │ Components    │  │
                                         │             │  │               │  │
                                         │             │  │ - StopSelector│  │
                                         └─────────────┼──►│ - Navigation  │  │
                                                       │  │ - StatusBar   │  │
                                                       │  │ - Departure   │  │
                                                       │  │   Board       │  │
                                                       │  │ - Ferry Map   │  │
                                                       │  └───────────────┘  │
                                                       └─────────────────────┘
```

## Key Components

### Data Sources

#### 1. TransLink GTFS (Static Schedule)
- **URL**: `https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip`
- **Size**: ~30MB compressed
- **Contents**: Complete public transport schedule for South East Queensland
- **Update Frequency**: Daily
- **Key Files**:
  - `routes.txt` - All transport routes (we filter for F* ferry routes)
  - `trips.txt` - Individual journey instances
  - `stop_times.txt` - Arrival/departure times for each stop
  - `stops.txt` - Stop locations and names
  - `calendar.txt` - Service patterns by day of week

#### 2. TransLink GTFS-RT (Real-time Updates)
- **Base URL**: `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/`
- **Format**: Protocol Buffers (protobuf)
- **Endpoints**:
  - `/TripUpdates` - Real-time departure times and delays
  - `/VehiclePositions` - Live GPS locations and occupancy
  - `/Alerts` - Service disruptions (not currently used)
- **Update Frequency**: ~30 seconds

### Processing Layer

#### Schedule Processor (`schedule-processor/process-schedule.js`)
- **Runs**: Daily at 3 AM Brisbane time via GitHub Actions
- **Functions**:
  1. Downloads latest GTFS ZIP from TransLink
  2. Extracts and parses CSV files
  3. Filters for ferry services (routes starting with 'F')
  4. Builds ferry stop connectivity graph
  5. Generates all departures for next 48 hours
  6. **Critical**: Converts Brisbane local times to UTC using `fromZonedTime`
  7. Outputs JSON with ferry stops, connectivity, and departures
- **Output**: `schedule-data/latest.json` (~3MB)

#### GitHub Pages CDN
- **URL**: `https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/latest.json`
- **Purpose**: Serves pre-processed schedule data
- **Benefits**: 
  - No CORS issues
  - Reduced bandwidth (3MB vs 30MB)
  - Faster parsing (JSON vs ZIP/CSV)
  - Includes connectivity data

### Frontend Services

#### staticGtfsService.js
- **Primary Functions**:
  1. Cache management with timestamp validation
  2. Fetches schedule from GitHub Pages
  3. Falls back to direct GTFS processing if needed
  4. Provides ferry stop and connectivity data
- **Cache Strategy**:
  - Stores in localStorage with 24-hour expiry
  - Always checks GitHub's `generated` timestamp
  - Updates cache only if GitHub has newer data
  - Ensures bug fixes are delivered immediately

#### ferryData.js
- **Core Logic**:
  1. Filters trips for selected origin/destination
  2. Validates trip sequences (destination must come after origin)
  3. Merges real-time and scheduled data using tripId
  4. Groups departures by direction (outbound/inbound)
- **Key Methods**:
  - `filterRelevantTrips()` - Initial filtering for selected stops
  - `checkDestination()` - Validates ferry continues to destination
  - `mergeDepartures()` - Combines schedule and real-time data

#### useFerryData Hook
- **Orchestration**:
  1. Loads real-time data first (fast, shows immediately)
  2. Loads schedule data in background
  3. Merges data streams seamlessly
  4. Manages 5-minute refresh interval
  5. Provides loading states to UI

### UI Components

#### StopSelectorModal
- Shows all 19 Brisbane ferry terminals
- Dynamically filters destinations based on connectivity
- Persists selection to localStorage
- Shows on first visit or via settings gear

#### DepartureBoard
- Displays departures for one direction
- Shows next 5 departures (expandable to 13)
- Real-time countdown timers
- Live/Scheduled status indicators

#### FerryMap
- Interactive Leaflet map
- Shows live ferry positions from VehiclePositions
- Updates every 5 minutes
- Displays occupancy and speed

## Storage & Caching

### localStorage Keys
- `brisbane-ferry-schedule-cache`: Cached departure data with generation timestamp
- `brisbane-ferry-selected-stops`: User's selected origin and destination

### Cache Validation Flow
1. User loads app
2. Check if cached data exists and is < 24 hours old
3. Fetch GitHub's latest.json to get `generated` timestamp
4. Compare timestamps:
   - If GitHub newer → fetch full data and update cache
   - If cache current → use cached data
   - If GitHub unreachable → use cache if available

## Architecture Benefits

1. **Performance**: Progressive loading shows live data immediately
2. **Reliability**: Multiple fallback layers ensure service availability
3. **Efficiency**: Pre-processed data reduces client computation
4. **Flexibility**: Supports any ferry terminal pair
5. **Freshness**: Smart cache validation delivers updates immediately
6. **Offline Support**: Cached schedule works without internet

## Critical Implementation Notes

### Timezone Handling
GTFS times are in Brisbane local time. The schedule processor must convert to UTC:
```javascript
// CORRECT - converts Brisbane time to UTC
const departureUTC = fromZonedTime(departureDate, 'Australia/Brisbane');

// WRONG - treats Brisbane time as UTC (causes 10-hour offset)
const departureZoned = toZonedTime(departureDate, 'Australia/Brisbane');
```

### Trip Sequence Validation
Always verify the destination comes after the origin in the stop sequence:
```javascript
const outboundIndex = stops.findIndex(s => s.id === origin);
const inboundIndex = stops.findIndex(s => s.id === destination);
if (inboundIndex > outboundIndex) {
  // Valid trip from origin to destination
}
```

### Cache Timestamp Storage
Always store the `generated` timestamp from GitHub in the cache to enable proper validation:
```javascript
localStorage.setItem(CACHE_KEY, JSON.stringify({
  timestamp: Date.now(),
  generated: data.generated,  // Critical for validation
  departures: data.departures
}));
```