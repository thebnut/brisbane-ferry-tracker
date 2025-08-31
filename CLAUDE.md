# Brisbane Ferry Tracker - Project Guide for Claude

## Documentation Structure
- **Main Guide**: This file (CLAUDE.md) - Core project information and current status
- **Supporting Docs**: `/docs/` folder - Additional technical documentation including:
  - Architecture documents (app-architecture.md, state-architecture.md)
  - Implementation plans and specifications
  - Historical feature documentation

## Project Overview
This is a single-page application that displays real-time ferry departures between any two Brisbane ferry terminals. Users can select their origin and destination stops from all available ferry terminals. It combines static GTFS schedule data with real-time GTFS-RT updates to show accurate ferry times even when services aren't actively running.

## Current Deployment Status

### Primary Production Deployment: Vercel
**URL**: https://brisbane-ferry-tracker.vercel.app/
**Custom Domains**: 
- https://ferry.lifemap.au/
- https://www.brisbaneferry.com/
- ✅ **Full functionality** - Live tracking + schedule data
- ✅ **Real-time updates** via CORS proxy
- ✅ **GitHub-hosted schedule** loaded first (fast)
- ✅ **Automatic fallback** to local GTFS processing
- ✅ **Ferry details modal** with comprehensive information
- ✅ **Interactive map** with live ferry positions
- ✅ **Service filter buttons** in header bar (All/Express)
- ✅ **Dynamic stop selector** for any ferry terminal pair
- ✅ **GPS-based ferry direction** indicators on maps

### Secondary Deployment: GitHub Pages
**URL**: https://thebnut.github.io/brisbane-ferry-tracker/
- ✅ **Schedule data only** (no live tracking)
- ❌ **No CORS proxy** (cannot access TransLink API)
- ✅ **Daily updates** via GitHub Actions
- 💡 **Use case**: Schedule reference when Vercel is down

## Key Architecture Decisions

### Progressive Loading Strategy
The app uses a two-stage loading approach for optimal user experience:
1. **Real-time data loads first** (fast) - Shows live ferries immediately
2. **Schedule data loads in background** (slow) - 30MB download that merges seamlessly

### Live Ferry Map
Interactive map showing real-time ferry positions:
- Uses Leaflet + React Leaflet for mapping
- Displays ferry locations from VehiclePositions GTFS-RT feed
- Shows only ferries traveling between Bulimba and Riverside
- Updates every 5 minutes with live data
- Visual indicators for Express (🚤) vs All-stops (🚢) services
- Popups show speed, occupancy, and next departure

### Data Sources
1. **Pre-processed Schedule Data** (Primary)
   - GitHub Pages hosted JSON (`https://thebnut.github.io/brisbane-ferry-tracker/data/latest.json`)
   - Generated daily at 3 AM Brisbane time via GitHub Actions
   - ~50KB filtered data (vs 30MB raw GTFS)
   - Cached in localStorage for 24 hours
   - Fallback to local development path when on localhost

2. **Static GTFS Data** (`/api/gtfs-static`) - Fallback only
   - ZIP file containing full schedule (~30MB)
   - Used only if GitHub data unavailable
   - Processed client-side

3. **Real-time GTFS-RT Data** (`/api/gtfs-proxy`)
   - Protobuf format real-time updates
   - Shows only actively running services
   - Takes precedence over scheduled data when available
   - Loads immediately on app start

### Important Constants
```javascript
// Stop IDs (from TransLink GTFS)
STOPS = {
  bulimba: "317584",      // Bulimba ferry terminal
  riverside: "317590",    // Riverside ferry terminal  
  apolloRoad: "317533"    // Apollo Road (near Bulimba) - currently unused
}

// Route IDs
ROUTES = {
  expressCityCat: "F11",    // Express service
  allStopsCityCat: "F1"     // All-stops service
}

// GTFS-RT Occupancy Status Values
OCCUPANCY_STATUS = {
  0: 'Empty',
  1: 'Many seats available',
  2: 'Few seats available',
  3: 'Standing room only',
  4: 'Crushed standing room only',
  5: 'Full',
  6: 'Not accepting passengers'
}

// GTFS-RT Vehicle Status Values
VEHICLE_STATUS = {
  0: 'Approaching stop',
  1: 'Stopped at terminal',
  2: 'In transit'
}
```

Note: Real-time routes may have suffixes like "F11-4055", so we use `startsWith()` for matching.
Note: GTFS-RT may send numeric or string enum values - the app handles both formats.

### Dynamic Stop Selector
Users can now select any ferry terminal pair (not just Bulimba-Riverside):
- On first visit: Modal prompts to select origin and destination stops
- Selections persist in localStorage
- Only shows destinations with direct ferry connections from selected origin
- Settings gear icon allows changing stops anytime

### Critical Filtering Logic
The app filters departures to show ONLY ferries that actually travel between the selected terminals:

1. **Initial Filter**: Trip must contain BOTH selected stops
2. **Direction Filter**: For each departure, verify the ferry goes TO the other terminal
   - Origin departures: Must have destination AFTER current position
   - Destination departures: Must have origin AFTER current position

See `docs/schedule-filtering-logic.md` for detailed explanation.

### State Management
- Uses React hooks (no Redux/Context needed)
- Custom `useFerryData` hook handles all data fetching and progressive loading
- Separate loading states for initial load vs schedule load
- Auto-refresh every 5 minutes + countdown timer every second
- **Two-tier state architecture for stop selections** - see `docs/state-architecture.md` for details

### Styling
- Tailwind CSS v3 (not v4 - important for compatibility)
- Custom colors: golden, ferry-blue, charcoal, cream
- Responsive design with mobile-first approach

## Common Issues & Solutions

### Issue: Wrong branch for development
**Solution:** Always work on `develop` branch
```bash
git checkout develop
```

### Issue: No departures showing
**Causes:**
1. Outside service hours (check if showing scheduled times)
2. Incorrect stop/route filtering
3. CORS issues with API

**Debug:**
- Check console for filtering logs
- Verify GTFS data is being fetched
- Check if cached data exists in localStorage

### Issue: Localhost showing fewer departures than Vercel
**Cause:** Stale schedule data in `public/schedule-data/latest.json`
**Solution:** Copy current data: `cp schedule-data/latest.json public/schedule-data/latest.json`
**Long-term:** Configure Vite to serve from root schedule-data or sync automatically

### Issue: Cache errors
**Solution:** Cache only processed departures, not raw GTFS data (30MB → 50KB)

### Issue: Slow initial load
**Solution:** Progressive loading - show live data immediately while schedule loads in background

### Issue: Wrong direction ferries showing
**Solution:** Check stop sequence to ensure ferry goes FROM current stop TO other terminal

### Issue: CORS errors on custom domain
**Solution:** Always use the proxy endpoint (`/api/gtfs-proxy`) for all deployments. The app now automatically uses the proxy to avoid CORS issues regardless of domain.

### Issue: Numeric enum values showing instead of text
**Solution:** Use `getOccupancyInfo()` and `getVehicleStatusInfo()` helper functions that handle both numeric and string enum values from GTFS-RT.

### Issue: LIVE tags not showing for non-Bulimba/Riverside routes
**Solution:** The app originally had hardcoded stop IDs. Now fixed to use dynamic selectedStops:
- `ferryData.js`: Uses `this.selectedStops` instead of hardcoded `STOPS.bulimba`/`STOPS.riverside`
- `staticGtfsService.js`: Accepts selectedStops parameter and uses it throughout
- Critical: Always pass selectedStops when calling `getScheduledDepartures()`

## Testing & Debugging

### Visual Testing Protocol
**IMPORTANT**: Always perform visual testing on the Vercel deployment, not localhost:
- **Development**: https://brisbane-ferry-tracker.vercel.app (develop branch)
- **Production**: https://ferry.lifemap.au or https://www.brisbaneferry.com (main branch)

This ensures testing includes:
- Real-world network latency
- Vercel's serverless functions and CORS proxy
- Production build optimizations
- Actual deployment environment behavior

### Key Debug Points
1. `ferryData.js:filterRelevantTrips()` - Shows which trips pass initial filter
2. `ferryData.js:checkDestination()` - Shows direction filtering
3. `staticGtfsService.js:getScheduledDepartures()` - Shows static schedule processing

### Test Scenarios
1. Early morning (4-5 AM): Should show scheduled times
2. Peak hours: Should show mix of live and scheduled
3. Late night: Should show next day's first services
4. After 12:30 PM on mobile: Should default to inbound tab (return journey)
5. Click any departure: Should show detailed modal with all available info
6. Test with different stop pairs: Hawthorne-Riverside, Bulimba-Northshore Hamilton, etc.

### Local Development
```bash
npm run dev     # Starts on http://localhost:5173
npm run build   # Test production build
```

### API Testing
```bash
# Test real-time data
curl http://localhost:5173/api/gtfs-proxy?endpoint=TripUpdates

# Test static GTFS
curl http://localhost:5173/api/gtfs-static -o gtfs.zip
```

## Performance Considerations
1. Static GTFS ZIP is ~30MB - fetched once and cached
2. Schedule cache expires after 24 hours (but validates against GitHub's timestamp)
3. Real-time updates every 5 minutes
4. Countdown timers update every second (force re-render)

## Critical Implementation Notes

### Timezone Handling in Schedule Processor
**CRITICAL**: GTFS schedule times are in local timezone (Brisbane). When processing:
```javascript
// WRONG - causes 10-hour offset
const departureZoned = toZonedTime(departureDate, TIMEZONE);

// CORRECT - converts Brisbane time to UTC for storage
const departureUTC = fromZonedTime(departureDate, TIMEZONE);
```

### Cache Validation
Always check if GitHub has newer data before using cache:
- Compare `generated` timestamps between cache and GitHub
- Prevents users being stuck with buggy data for 24 hours
- Implemented in `staticGtfsService.getScheduledDepartures()`

## Deployment Architecture

### Data Flow
1. **Schedule Data**: GitHub Actions → GitHub Pages → Both deployments
2. **Live Data**: TransLink API → Vercel Proxy → Vercel deployment only

### GitHub Repository Structure
- **`main` branch**: Production code → Deploys to ferry.lifemap.au and www.brisbaneferry.com
- **`develop` branch**: Pre-production code → Deploys to brisbane-ferry-tracker.vercel.app
- **schedule-data/**: Updated daily by GitHub Action (on main branch)
- **schedule-processor/**: Node.js app that generates schedule JSON
- **.github/workflows/**: Runs daily at 3 AM Brisbane time

### Development Workflow
```bash
# Daily development (you should be on develop branch)
git checkout develop
git add .
git commit -m "Feature: description"
git push
# Auto-deploys to brisbane-ferry-tracker.vercel.app for testing

# Release to production
git checkout main
git merge develop
git push
# Auto-deploys to ferry.lifemap.au and www.brisbaneferry.com

# Return to development
git checkout develop
```

### Post-Deployment Checklist
After deploying new features to production:
1. **Update README.md** with latest implementation details:
   - New features added to Features section
   - Update technical documentation references if new docs added
   - Update environment variables if new ones required
   - Ensure all component paths and architecture descriptions are current
2. **Update this CLAUDE.md** if significant architecture changes made
3. **Test deployment** using Playwright for visual validation and console errors
4. **Verify** all documentation links work correctly

### Manual Deployment Commands (if needed)
```bash
# Deploy current branch to Vercel
vercel

# Deploy to production specifically
vercel --prod
```

### Environment URLs
| Environment | URL | Branch | Purpose |
|------------|-----|--------|---------|
| Production | https://ferry.lifemap.au<br>https://www.brisbaneferry.com | `main` | Live site for end users |
| Pre-production | https://brisbane-ferry-tracker.vercel.app | `develop` | Testing new features |
| Local Dev | http://localhost:5173 | `develop` | Active development |

### Key Differences Between Deployments
| Feature | Production (ferry.lifemap.au / brisbaneferry.com) | Pre-prod (vercel.app) | GitHub Pages |
|---------|-------------------------------|----------------------|--------------|
| Live ferry tracking | ✅ | ✅ | ❌ |
| Live ferry map | ✅ | ✅ | ❌ |
| Schedule data | ✅ | ✅ | ✅ |
| CORS proxy | ✅ | ✅ | ❌ |
| Auto-refresh | ✅ | ✅ | ✅ |
| Branch | `main` | `develop` | `main` |

## Recent Updates
1. **Dynamic Stop Selector** - Users can choose any ferry terminal pair
   - Modal on first visit to select origin/destination
   - Only shows destinations with direct connections
   - Settings gear to change stops anytime
   - Persists selection in localStorage
2. **Smart Cache Validation** - Prevents stale data issues
   - Checks GitHub's `generated` timestamp before using cache
   - Ensures users get bug fixes immediately (not after 24h cache expiry)
   - Falls back to cache if GitHub unavailable
3. **Ferry Details Modal** - Click/tap any departure to see comprehensive ferry information
   - Live position map (when GPS available)
   - Schedule vs actual times
   - Journey duration and delays
   - Occupancy and vehicle status
   - Keyboard accessible (ESC to close)
4. **GTFS-RT Enum Handling** - Proper display of numeric enum values:
   - Occupancy status (0-6): Empty, Many seats, Few seats, Standing room, etc.
   - Vehicle status (0-2): Approaching stop, Stopped at terminal, In transit
5. **Smart Mobile Tab Selection** - Automatically shows relevant direction based on time:
   - Before 12:30 PM: Shows "To [Destination]" (outbound)
   - After 12:30 PM: Shows "To [Origin]" (inbound)
6. **Custom Domain Support** - ferry.lifemap.au and www.brisbaneferry.com work with proper CORS handling
7. **Map Improvements**:
   - CartoDB Positron tiles for modern, minimal appearance
   - Removed river overlay for cleaner look
   - Map button in status bar
   - Hide button in map header
   - Smaller, cleaner ferry icons
8. **Mobile-Responsive Tabs** - Departure boards use tabs on mobile instead of stacking
9. **Previous Updates**:
   - Live Ferry Map with real-time positions
   - GitHub Pages Schedule Caching
   - Progressive Loading strategy
   - TripId-based Merging
   - "More..." Button (5 + 8 more)
   - Scheduled Time Display
   - Dynamic Status Messages
   - First-time Loading Message
   - Configurable Debug Logging

## Common Data Flow Issues & Solutions

### Issue: Scheduled Departures Not Showing Arrival Times
**Problem**: Scheduled ferries showed "Arrival time not available" instead of actual arrival times.

**Root Causes**:
1. **GitHub Schedule Data Structure**: The schedule processor generates ALL ferry departures for ALL stops without pre-calculating arrival times for specific stop pairs
2. **Missing Client-Side Processing**: The app was using raw GitHub data without:
   - Filtering for selected stops
   - Calculating arrival times from trip data
   - Verifying trips go between selected terminals
3. **Double Filtering**: After processing, ferryData.js was applying additional filtering that removed all scheduled departures

**Solution**:
1. **Added `processGitHubDepartures` method** in staticGtfsService.js:
   - Groups departures by tripId to find complete trips
   - Filters for selected stops and ferry routes
   - Finds destination stops and calculates arrival times
   - Only includes trips that go between selected terminals

2. **Skip Double Filtering** in ferryData.js:
   - Check if departures already have `direction` property (indicates processing)
   - Skip additional filtering for pre-processed departures

3. **GTFS Time Handling**:
   - GTFS uses "arrival_time" and "departure_time" fields
   - If arrival_time is missing, fall back to departure_time
   - For schedule data, arrival ≈ departure - 1 minute at ferry stops

**Key Learning**: When using pre-processed data (GitHub), ensure client-side processing matches what the GTFS fallback path does. Don't assume pre-processed data is ready to use directly.

### Ferry Data Status Levels
The app has three distinct data availability states for ferry departures, now clearly indicated by badge combinations:

1. **Scheduled Only**
   - Source: GTFS static schedule data
   - Shows: Planned departure/arrival times
   - Badges: "SCHEDULED" (gray)
   - No real-time updates

2. **Live (Schedule Updates Only)**
   - Source: GTFS-RT TripUpdates feed
   - Shows: Real-time departure delays/updates
   - Badges: "LIVE" (green with pulse) only
   - Has `isRealtime: true` but no GPS position
   - Common when ferry is at terminal or GPS unavailable

3. **Live (Full GPS Tracking)**
   - Source: GTFS-RT TripUpdates + VehiclePositions feeds
   - Shows: Everything above PLUS:
     - Live position on map
     - Current speed
     - Occupancy status
     - Vehicle status (approaching/stopped/in transit)
   - Badges: "LIVE" (green with pulse) + "GPS" (green with pulse, location icon)
   - Has both `isRealtime: true` AND `position` data

**Badge Logic**:
- "LIVE" badge: Appears when `departure.isRealtime === true` (real-time schedule updates)
- "GPS" badge: Appears when `hasLiveData === true` (GPS position available)
- Both badges can appear independently, providing clear visibility into data availability
- GPS-dependent features (map, speed, occupancy) only show when GPS badge is present

## Puppeteer MCP Testing Notes

### Selector Syntax
When using Puppeteer MCP commands, note these selector limitations:
- ❌ Pseudo-selectors like `:has-text()` or `:contains()` don't work
- ❌ jQuery-style selectors are not supported
- ✅ Use standard CSS selectors or evaluate scripts to find elements by text

### Working Examples
```javascript
// Finding elements by text content
const button = Array.from(document.querySelectorAll('button')).find(btn => 
  btn.textContent.includes('Cancel')
);

// Clicking multiple elements
const moreButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
  btn.textContent.includes('More')
);
moreButtons.forEach(btn => btn.click());
```

### Browser Context Issues
- The browser frame can become detached after navigation errors
- Solution: Pass empty `launchOptions: {}` to restart the browser context
- Example: `mcp__puppeteer__puppeteer_navigate` with `launchOptions: {}`

## Current App Status (January 2025)

### Latest Features
1. **Date Display for Tomorrow's Departures** (January 2025)
   - Shows (DD/MM) in orange after time for next-day services
   - Helps prevent confusion for late-night ferry services
   - Applied to DepartureItem, FerryDetailsModal, and FerryMap
   - Uses Australian date format

2. **Clean Stop Names** (January 2025)
   - Removed "ferry terminal" from all stop name displays
   - Departure board headers: "Riverside → Hawthorne" instead of "Riverside ferry terminal → Hawthorne ferry terminal"
   - Mobile tab headers: "To Riverside" instead of "To Riverside ferry terminal"
   - Navigation bar already had this implemented

3. **Service Filter in Header** (January 2025)
   - All Services and Express filter buttons moved to header bar
   - Buttons match Map/Refresh button styling
   - Conditionally hidden when no express services available
   - Improves content area clarity and maintains filter visibility while scrolling

4. **Ferry Vessel Names** (January 2025)
   - Displays human-readable vessel names (e.g., "Mooroolbin II")
   - Extracted from vehicle ID by taking last segment after underscore
   - Preserves Roman numerals in uppercase

5. **Enhanced Status Badges** (January 2025)
   - Separate LIVE and GPS badges for clarity
   - LIVE badge: Real-time schedule updates available
   - GPS badge: Live position tracking available
   - Both can appear independently

### UI/UX Improvements
- **Header Bar**: Compact design with Last Updated, service filters, Map, and Refresh
- **Mobile Responsive**: Filter buttons scale appropriately on small screens
- **Clean Interface**: Removed redundant "ferry terminal" text throughout
- **Smart Visibility**: UI elements hide when not relevant (e.g., no express services)
- **Progressive Enhancement**: Core functionality works even without all data sources

## Recent UI/UX Updates (January 2025)

### Ferry Details Modal Simplification
1. **Removed Live Information Section**
   - Eliminated separate Speed, Occupancy, and Status display
   - Cleaner, more focused interface
   - Less redundant information

2. **Updated Vehicle Display**
   - Removed "Trip #" from header
   - New format: "Vehicle: [name] | [status]"
   - Status integrated inline with vehicle name
   - Example: "Vehicle: Meeandah | In Transit"

### Map Marker Updates
1. **Removed Directional Arrows**
   - Ferry markers now show as simple pulsing dots
   - No bearing/rotation indicators
   - Cleaner, less cluttered map appearance
   
2. **Visual Design**
   - Pulsing animation every 2 seconds
   - Red dots for express ferries
   - Teal dots for all-stops ferries
   - White borders with drop shadows
   - Consistent design across main map and detail map

### Time Display Improvements
1. **Hour Display for Long Countdowns**
   - Ferries > 60 minutes away show hours (e.g., "in 1 hr 28 mins")
   - Cleaner display for ferries > 1 hour away (no countdown shown)
   - Journey times in modal also show hours when applicable

2. **Mobile Text Clipping Fix**
   - Scheduled time moved to separate line to prevent clipping
   - Format: "Scheduled: X:XX PM" on its own line
   - Better readability on small screens

3. **Departure Item Alignment**
   - Fixed vertical misalignment between columns on desktop
   - Added minimum height (`min-h-[6rem]`) to all departure items
   - Consistent spacing with invisible placeholder for scheduled time
   - Removed occupancy status display for cleaner interface
   - Moved delay information to right side

4. **Stop Selector Modal Improvements**
   - Orange theme matching app design
   - Removed "ferry terminal" from stop names
   - Added ferry emoji (🛥️) to header
   - Improved focus states and animations

5. **"On Time" Status**
   - Shows "Sched Dept: [time]" for real-time ferries with no delay (January 2025)
   - Previously showed "On time" - changed to show scheduled departure time
   - Helps passengers know when ferry will depart even if it arrives early
   - Falls back to "On time" only if scheduled time unavailable

6. **Nearest Stop Feature** (January 2025)
   - Added "Nearest Stop" button to stop selector map
   - Uses browser geolocation API to find user's location
   - Calculates distance to all ferry stops using Haversine formula
   - Highlights nearest stop with green border and animation
   - Shows user location as blue pulsing marker on map
   - Displays distance to nearest stop (e.g., "150m" or "1.2km")
   - Auto-selects nearest stop based on current selection mode (origin/destination)
   - Handles permission denial gracefully with clear error messages
   - Warns if nearest stop is > 5km away
   - Requires HTTPS for geolocation access
   - No location data is stored or transmitted
   - See `docs/nearest_stop_prd.md` and `docs/nearest_stop_trd.md` for implementation details

### Logo and Branding Updates
1. **New Logo**: BrisbaneFerry Departure Boards with Integrated Text
   - Using bf.com_logo_text.png with text built into the logo image
   - Significantly larger display (h-16 md:h-28)
   - Left-aligned positioning
   - Increased mobile max-width to 280px for text readability
   - Compact header with minimal padding (py-1)

2. **Mobile Logo Handling**
   - Added max-width constraint to prevent squishing
   - Responsive sizing: smaller on mobile (h-16) vs desktop (h-28)

### Developer Features
1. **URL Parameter for GitHub Data**
   - Add `?useGitHub=true` to use production data on localhost
   - Helps test with latest schedule without modifying code
   - Console logging shows which data source is active

2. **Return Leg Focus Feature** (Removed but documented)
   - Previously auto-switched to inbound tab after 12:30 PM
   - Removed January 2025 based on user feedback
   - Full implementation details in `docs/returnLegFocus.md`
   - Can be reimplemented as user-configurable option

3. **Remember Selection Toggle Persistence** (Fixed January 2025)
   - Issue: Toggle state wasn't persisting across page reloads
   - Solution: Store the preference itself in localStorage
   - Modal shows if: no saved stops OR remember preference is false
   - When remember is turned OFF, also clears reverse preference
   - Consistent behavior with both toggle states now persisting

4. **Dropdown Headers for Quick Stop Changes** (Added January 2025)
   - **Desktop**: Origin and destination shown as dropdowns in board headers
   - **Mobile**: Dropdowns replace tabs, with switch direction button (⇄)
   - **Temporary selections**: Changes via dropdowns don't persist if "Remember selection" is ON
   - **Validation**: Destinations update based on selected origin
   - **Components**:
     - `StopDropdown`: Reusable styled dropdown component
     - `BoardHeader`: Desktop header with two dropdowns
     - `MobileBoardHeader`: Mobile header with dropdowns and switch button
   - **State Management**: `temporaryStops` state tracks session-based selections (see `docs/state-architecture.md`)

## Important Implementation Details

### Mobile Tab Behavior
- Always defaults to outbound (first departure board)
- No automatic switching based on time of day
- Users can manually switch between tabs

### Stop Name Cleaning
- `cleanStopName()` function removes " ferry terminal" suffix
- Applied consistently across:
  - DepartureBoard headers
  - StopSelectorModal dropdowns and preview
  - Mobile tab headers

### Countdown Timer Logic
```javascript
// Don't show countdown for trips more than 1 hour away
if (minutesUntil > 60) return null;
```

### Status Display Priority
1. If not real-time: Show invisible placeholder
2. If real-time with delay: Show "Scheduled: X:XX PM"
3. If real-time without delay: Show "Sched Dept: X:XX PM" (shows scheduled departure time)
4. If real-time but no scheduled time available: Show "On time"

## Future Enhancements to Consider
1. Service alerts integration
2. Walking time to terminal
3. Favorite routes
4. Push notifications for imminent departures
5. Historical reliability data
6. User settings/preferences modal
7. Reimplement return leg focus as optional feature
8. Dark mode support
9. PWA capabilities for offline access
10. Trip planning (multi-stop journeys)