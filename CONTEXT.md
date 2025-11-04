# Brisbane Transit Tracker - Development Context

**Last Updated:** November 4, 2025
**Current Branch:** mode-abstraction-v2

## Overview

This project is a real-time transit tracker for Brisbane, supporting both **ferry** and **train** modes through a unified, mode-agnostic architecture. The app provides live departure times, real-time tracking, and intelligent station/stop connectivity.

## Recent Major Changes (Nov 3-4, 2025)

### 1. Train Mode UI Polish
**Commits:** `577b929`, `f3063f0`

**Problem:** Train station names displayed with "station" suffix in dropdowns and modals, creating verbose UI (e.g., "Morningside station → Roma Street station").

**Solution:** Implemented consistent station name cleaning across all UI components:
- **Files Modified:**
  - `src/components/StopDropdown.jsx` - Main page dropdowns
  - `src/components/StopSelectorModal.jsx` - Settings modal
  - `src/components/DepartureBoard.jsx` - Board headers
  - `src/components/DepartureItem.jsx` - Headsign display
  - `src/components/FerryDetailsModal.jsx` - Trip details

**Implementation:**
```javascript
const cleanStationName = (name) => {
  if (!name) return '';
  return name.replace(' ferry terminal', '').replace(/ station$/i, '');
};
```

**Result:**
- Dropdowns: "Morningside" ✓ (was "Morningside station")
- Headsigns: "to Roma Street" ✓ (was "to CLSH to ROMA_STREET")
- Modal: "Morningside → Roma Street" ✓ (was "Origin → CLSH to ROMA_STREET")

---

### 2. Departure Time Filter for Train Mode
**Commits:** `f4e4b9d`, `c8708c9`

**Problem:** The "Depart from:" dropdown was visible in train mode but non-functional. Changing the time would trigger unnecessary API re-fetches despite the client already having 4 hours of data.

**Solution:** Two-phase implementation:

#### Phase 1: Enable Filtering (`f4e4b9d`)
- Updated `useTrainData.js` to accept `departureTimeFilter` parameter
- Added server-side filtering in fetch function
- Updated `useTransitData.js` to pass filter to both outbound/inbound calls

#### Phase 2: Client-Side Optimization (`c8708c9`)
- **Problem Identified:** Every filter change triggered slow API call
- **Root Cause:** `departureTimeFilter` in fetchSchedule dependency array
- **Solution:** Move filtering to `useMemo` hook for instant client-side filtering

**Files Modified:**
- `src/hooks/useTrainData.js`
- `src/hooks/useTransitData.js`

**Key Changes:**
```javascript
// Before: API re-fetch on every filter change
}, [origin, destination, hours, departureTimeFilter, modeConfig]);

// After: Client-side filtering only
}, [origin, destination, hours, modeConfig]);

const data = useMemo(() => {
  if (!unfilteredData) return null;
  if (!departureTimeFilter) return unfilteredData;

  const filteredDepartures = unfilteredData.departures.filter(
    dep => dep.departureTime >= departureTimeFilter
  );

  return { ...unfilteredData, departures: filteredDepartures };
}, [unfilteredData, departureTimeFilter]);
```

**Performance Impact:**
- **Before:** 2-5 second API call on filter change
- **After:** Instant (<1ms) client-side filter
- **UX:** No loading spinner when changing time filter

---

### 3. Train Station Connectivity Filtering
**Commits:** `d5b69d0`, `a37d641`

**Problem:** Station destination dropdowns showed ALL 154 stations regardless of origin, including impossible routes requiring transfers (e.g., Morningside → Nambour would require transfer at Central).

**Solution:** Built connectivity map from GTFS data to show only directly reachable stations.

#### Implementation

**New Script:** `schedule-processor/build-train-connectivity.js`
- Downloads GTFS data (3M+ stop_times)
- Analyzes 12,831 train trips
- Maps 363 platforms → 154 stations
- Builds station-level connectivity graph
- Output: 153 stations, 8,003 connections, avg 52.3 destinations/station

**Algorithm:**
```javascript
For each train trip:
  For each station in trip sequence:
    Mark all subsequent stations as directly reachable
```

**Generated File:** `src/data/trainStationConnectivity.json` (136KB)
```json
{
  "MORNINGSIDE": ["NORMAN_PARK", "COORPAROO", "BURANDA", ...],
  "ROMA_STREET": ["CENTRAL", "FORTITUDE_VALLEY", ...],
  ...
}
```

**UI Integration:**
- `src/components/StopSelectorModal.jsx` - Settings modal dropdowns
- `src/App.jsx` - Main page dropdowns

**Connectivity Examples:**
- **Morningside:** 42 destinations (Beenleigh line + connections)
- **Roma Street:** 152 destinations (major hub, connects to almost all lines)
- **Central:** 152 destinations (major hub)
- **Shorncliffe:** ~20 destinations (branch line terminus)

**Result:**
- ✅ Shows only valid direct routes (no transfers)
- ✅ Educational - users learn which lines connect
- ✅ Prevents invalid station pair selections
- ✅ Better UX - realistic destination options

---

## Current Architecture

### Mode Abstraction System

**Core Files:**
- `src/config/index.js` - ModeProvider and mode selection
- `src/config/modes/ferry.config.js` - Ferry-specific config
- `src/config/modes/train.config.js` - Train-specific config

**Data Hooks:**
- `src/hooks/useTransitData.js` - Universal hook, switches between modes
- `src/hooks/useFerryData.js` - Ferry GTFS-RT data
- `src/hooks/useTrainData.js` - Train schedule + GTFS-RT overlay

**Key Features:**
- Mode-specific branding (logos, colors, labels)
- Mode-specific data sources (APIs, connectivity)
- Mode-specific UI behavior (map, filters, features)
- Seamless mode switching via environment variable

---

## Train Mode Data Flow

### 1. Initial Load
```
User selects stations
  ↓
useTrainData fetches:
  - Static schedule (4 hours) from Train API
  - GTFS-RT data for live updates
  ↓
Merge realtime with static
  ↓
Store as unfilteredData
```

### 2. Time Filtering
```
User changes "Depart from:" dropdown
  ↓
useMemo re-computes filtered data
  ↓
Instant update (no API call)
```

### 3. Station Filtering
```
User changes origin station
  ↓
Load connectivity[originStation]
  ↓
Update validDestinations
  ↓
Destination dropdown shows only reachable stations
```

---

## Station Connectivity Data

**Generation:**
```bash
cd schedule-processor
node build-train-connectivity.js
```

**Output:** `src/data/trainStationConnectivity.json`

**When to Regenerate:**
- GTFS data updates (new routes/stations)
- Network changes (new lines, station closures)
- Typically: Monthly or when Queensland Rail updates schedule

---

## Train API Endpoints

**Base:** `/api/schedule/train`

**Route Endpoint:** `/route?origin={STATION_SLUG}&destination={STATION_SLUG}&hours={HOURS}`
- Returns static schedule for next N hours
- Format: Array of departures with platform details
- Example: `/route?origin=MORNINGSIDE&destination=ROMA_STREET&hours=4`

**Data Format:**
```javascript
{
  origin: { name: "Morningside station", id: "MORNINGSIDE" },
  destination: { name: "Roma Street station", id: "ROMA_STREET" },
  departures: [
    {
      tripId: "34564240-QR_25_26-40750-DA13",
      scheduledDeparture: "08:34:00",
      platform: "2",
      headsign: "ROMA_STREET",
      platformDetails: { origin: { id: "600123", platform: "2" } }
    }
  ]
}
```

---

## Ferry Mode Data Flow

**Different from Train:**
- Uses static GTFS schedule processing
- Real-time GTFS-RT for live positions
- Connectivity built during schedule processing
- Stored in `schedule-data/latest.json`

**Similarities:**
- Same connectivity filtering pattern
- Same UI components (mode-agnostic)
- Same time filtering logic

---

## Key Technical Decisions

### 1. Client-Side Time Filtering
**Why:** Train API already returns 4 hours of data. Re-fetching for filter changes wastes:
- Server resources
- Network bandwidth
- User wait time

**Implementation:** `useMemo` hook filters cached data instantly

### 2. Station-Level Connectivity
**Why:** Platform-level would be too granular (363 platforms vs 154 stations)

**Benefits:**
- Simpler UX (users think in stations, not platforms)
- Smaller data file (153 entries vs 363)
- Matches user mental model

### 3. Separate Train vs Ferry Logic
**Why:** Different data sources require different processing
- Ferry: GTFS schedule processing
- Train: API + GTFS-RT overlay

**Unified:** Through `useTransitData` abstraction

---

## Testing Checklist

### Train Mode Features
- [ ] Station name cleaning works in all locations
- [ ] Time filter shows only future departures
- [ ] Time filter doesn't trigger API re-fetch
- [ ] Origin dropdown shows all 154 stations
- [ ] Destination dropdown shows only connected stations
- [ ] Selecting new origin updates destination options
- [ ] Invalid destination resets to first valid option
- [ ] Modal and main page dropdowns behave identically
- [ ] Headsigns show clean destination names

### Ferry Mode Features
- [ ] Terminal names cleaned (no "ferry terminal")
- [ ] Connectivity filtering works
- [ ] Time filtering works
- [ ] Map shows live positions
- [ ] Service filters work (All/Express)

---

## Known Issues / Future Work

### Train Mode
- **Platform accuracy:** Some platforms may be incorrect due to GTFS data quality
- **Express services:** No express/all-stops filtering yet (planned Phase 4)
- **Live map:** Not implemented (planned Phase 4)
- **Service disruptions:** No alerts/notices system yet

### Ferry Mode
- **Robust:** Most features complete
- **Future:** Real-time capacity data if TransLink provides it

---

## Development Setup

### Environment Variables
```bash
# Mode selection (default: ferry)
VITE_MODE=train  # or 'ferry'

# Analytics
VITE_GA_FERRY=G-XXXXXXXXXX
VITE_GA_TRAIN=G-XXXXXXXXXX

# Vercel Blob (for schedule data upload)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxx
```

### Running Dev Server
```bash
npm run dev
```

### Building
```bash
npm run build
```

### Deploying
```bash
# Automatic via Vercel on push to main
git push origin main
```

---

## File Structure (Key Files)

```
brisbane-ferry-tracker/
├── src/
│   ├── config/
│   │   ├── index.js                    # ModeProvider
│   │   └── modes/
│   │       ├── ferry.config.js         # Ferry configuration
│   │       └── train.config.js         # Train configuration
│   ├── hooks/
│   │   ├── useTransitData.js           # Universal data hook
│   │   ├── useFerryData.js             # Ferry GTFS-RT
│   │   └── useTrainData.js             # Train API + GTFS-RT
│   ├── components/
│   │   ├── StopSelectorModal.jsx       # Settings modal
│   │   ├── StopDropdown.jsx            # Main page dropdowns
│   │   ├── DepartureBoard.jsx          # Departure list
│   │   ├── DepartureItem.jsx           # Individual departure card
│   │   └── FerryDetailsModal.jsx       # Trip details modal
│   ├── data/
│   │   └── trainStationConnectivity.json  # Station connectivity map
│   ├── services/
│   │   ├── gtfsService.js              # GTFS-RT parsing
│   │   └── staticGtfsService.js        # Ferry schedule processing
│   └── App.jsx                         # Main app component
├── schedule-processor/
│   ├── build-train-connectivity.js     # Generate connectivity map
│   ├── process-schedule.js             # Ferry schedule processor
│   └── train-stations-grouped.json     # Platform→Station mapping
└── api/
    └── schedule/
        └── train/
            └── route.js                # Train API endpoint
```

---

## Version History

### Current (Mode Abstraction v2)
- ✅ Train mode fully functional
- ✅ Station connectivity filtering
- ✅ Client-side time filtering
- ✅ Clean UI (no "station" suffix)
- ✅ Dual-mode support (ferry + train)

### Previous Releases
- **v1.2.0** - Orange redesign, mobile optimization
- **v1.1.0** - Ferry vessel names, LIVE badges
- **v1.0.0** - Initial ferry tracker release

---

## Maintenance

### Regular Tasks
- **Weekly:** Check GTFS-RT data quality
- **Monthly:** Regenerate train connectivity if Queensland Rail updates schedule
- **Quarterly:** Review and update dependencies

### Monitoring
- **Analytics:** Track usage via Google Analytics
- **Errors:** Monitor Vercel logs for API failures
- **Performance:** Check Vercel Speed Insights

---

## Contributing

When adding features:
1. Maintain mode abstraction - code should work for both ferry and train
2. Update this CONTEXT.md file
3. Test both modes thoroughly
4. Follow existing patterns (hooks, components, services)
5. Document configuration in mode config files

---

## Support

**Issues:** [GitHub Issues](https://github.com/thebnut/brisbane-ferry-tracker/issues)
**Discussions:** Use GitHub Discussions for questions
**Data Source:** [TransLink Open Data](https://gtfsrt.api.translink.com.au/)

---

*This document is maintained as a living record of the project's technical decisions and current state.*
