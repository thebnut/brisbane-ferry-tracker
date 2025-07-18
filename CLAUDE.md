# Brisbane Ferry Tracker - Project Guide for Claude

## Project Overview
This is a single-page application that displays real-time ferry departures between Bulimba and Riverside ferry terminals in Brisbane. It combines static GTFS schedule data with real-time GTFS-RT updates to show accurate ferry times even when services aren't actively running.

## Current Deployment Status

### Primary Production Deployment: Vercel
**URL**: https://brisbane-ferry-tracker.vercel.app/
**Custom Domain**: https://ferry.lifemap.au/
- ✅ **Full functionality** - Live tracking + schedule data
- ✅ **Real-time updates** via CORS proxy
- ✅ **GitHub-hosted schedule** loaded first (fast)
- ✅ **Automatic fallback** to local GTFS processing
- ✅ **Ferry details modal** with comprehensive information
- ✅ **Interactive map** with live ferry positions

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

### Critical Filtering Logic
The app filters departures to show ONLY ferries that actually travel between the two terminals:

1. **Initial Filter**: Trip must contain BOTH Bulimba AND Riverside stops
2. **Direction Filter**: For each departure, verify the ferry goes TO the other terminal
   - Bulimba departures: Must have Riverside AFTER current position
   - Riverside departures: Must have Bulimba AFTER current position

See `schedule-filtering-logic.md` for detailed explanation.

### State Management
- Uses React hooks (no Redux/Context needed)
- Custom `useFerryData` hook handles all data fetching and progressive loading
- Separate loading states for initial load vs schedule load
- Auto-refresh every 5 minutes + countdown timer every second

### Styling
- Tailwind CSS v3 (not v4 - important for compatibility)
- Custom colors: golden, ferry-blue, charcoal, cream
- Responsive design with mobile-first approach

## Common Issues & Solutions

### Issue: No departures showing
**Causes:**
1. Outside service hours (check if showing scheduled times)
2. Incorrect stop/route filtering
3. CORS issues with API

**Debug:**
- Check console for filtering logs
- Verify GTFS data is being fetched
- Check if cached data exists in localStorage

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

## Testing & Debugging

### Key Debug Points
1. `ferryData.js:filterRelevantTrips()` - Shows which trips pass initial filter
2. `ferryData.js:checkDestination()` - Shows direction filtering
3. `staticGtfsService.js:getScheduledDepartures()` - Shows static schedule processing

### Test Scenarios
1. Early morning (4-5 AM): Should show scheduled times
2. Peak hours: Should show mix of live and scheduled
3. Late night: Should show next day's first services
4. After 12:30 PM on mobile: Should default to "To Bulimba" tab
5. Click any departure: Should show detailed modal with all available info

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
2. Schedule cache expires after 24 hours
3. Real-time updates every 5 minutes
4. Countdown timers update every second (force re-render)

## Deployment Architecture

### Data Flow
1. **Schedule Data**: GitHub Actions → GitHub Pages → Both deployments
2. **Live Data**: TransLink API → Vercel Proxy → Vercel deployment only

### GitHub Repository Structure
- **Main branch**: Contains both source code and GitHub Pages build
- **schedule-data/**: Updated daily by GitHub Action
- **schedule-processor/**: Node.js app that generates schedule JSON
- **.github/workflows/**: Runs daily at 3 AM Brisbane time

### Deployment Commands
```bash
# Deploy to Vercel (primary)
vercel --prod

# Build for GitHub Pages
npm run build
# Copy dist/* to root and commit
```

### Key Differences Between Deployments
| Feature | Vercel | GitHub Pages |
|---------|--------|--------------|
| Live ferry tracking | ✅ | ❌ |
| Live ferry map | ✅ | ❌ |
| Schedule data | ✅ | ✅ |
| CORS proxy | ✅ | ❌ |
| Auto-refresh | ✅ | ✅ |
| API costs | Minimal | None |

## Recent Updates
1. **Ferry Details Modal** - Click/tap any departure to see comprehensive ferry information
   - Live position map (when GPS available)
   - Schedule vs actual times
   - Journey duration and delays
   - Occupancy and vehicle status
   - Keyboard accessible (ESC to close)
2. **GTFS-RT Enum Handling** - Proper display of numeric enum values:
   - Occupancy status (0-6): Empty, Many seats, Few seats, Standing room, etc.
   - Vehicle status (0-2): Approaching stop, Stopped at terminal, In transit
3. **Smart Mobile Tab Selection** - Automatically shows relevant direction based on time:
   - Before 12:30 PM: Shows "To Riverside" (outbound)
   - After 12:30 PM: Shows "To Bulimba" (inbound)
4. **Custom Domain Support** - ferry.lifemap.au works with proper CORS handling
5. **Map Improvements**:
   - CartoDB Positron tiles for modern, minimal appearance
   - Removed river overlay for cleaner look
   - Map button in status bar
   - Hide button in map header
   - Smaller, cleaner ferry icons
6. **Mobile-Responsive Tabs** - Departure boards use tabs on mobile instead of stacking
7. **Previous Updates**:
   - Live Ferry Map with real-time positions
   - GitHub Pages Schedule Caching
   - Progressive Loading strategy
   - TripId-based Merging
   - "More..." Button (5 + 8 more)
   - Scheduled Time Display
   - Dynamic Status Messages
   - First-time Loading Message
   - Configurable Debug Logging

## Future Enhancements to Consider
1. Service alerts integration
2. Walking time to terminal
3. Favorite routes
4. Push notifications for imminent departures
5. Historical reliability data