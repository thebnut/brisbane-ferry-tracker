# Brisbane Ferry Tracker - Project Guide for Claude

## Project Overview
This is a single-page application that displays real-time ferry departures between Bulimba and Riverside ferry terminals in Brisbane. It combines static GTFS schedule data with real-time GTFS-RT updates to show accurate ferry times even when services aren't actively running.

## Key Architecture Decisions

### Data Sources
1. **Static GTFS Data** (`/api/gtfs-static`)
   - ZIP file containing scheduled ferry times
   - Cached in localStorage for 24 hours
   - Provides base schedule when real-time data unavailable

2. **Real-time GTFS-RT Data** (`/api/gtfs-proxy`)
   - Protobuf format real-time updates
   - Shows only actively running services
   - Takes precedence over static data when available

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
```

Note: Real-time routes may have suffixes like "F11-4055", so we use `startsWith()` for matching.

### Critical Filtering Logic
The app filters departures to show ONLY ferries that actually travel between the two terminals:

1. **Initial Filter**: Trip must contain BOTH Bulimba AND Riverside stops
2. **Direction Filter**: For each departure, verify the ferry goes TO the other terminal
   - Bulimba departures: Must have Riverside AFTER current position
   - Riverside departures: Must have Bulimba AFTER current position

See `schedule-filtering-logic.md` for detailed explanation.

### State Management
- Uses React hooks (no Redux/Context needed)
- Custom `useFerryData` hook handles all data fetching
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

### Issue: Wrong direction ferries showing
**Solution:** Check stop sequence to ensure ferry goes FROM current stop TO other terminal

## Testing & Debugging

### Key Debug Points
1. `ferryData.js:filterRelevantTrips()` - Shows which trips pass initial filter
2. `ferryData.js:checkDestination()` - Shows direction filtering
3. `staticGtfsService.js:getScheduledDepartures()` - Shows static schedule processing

### Test Scenarios
1. Early morning (4-5 AM): Should show scheduled times
2. Peak hours: Should show mix of live and scheduled
3. Late night: Should show next day's first services

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

## Deployment Notes
- Vercel serverless functions handle CORS proxy
- Environment variables not needed (API URLs are public)
- Static GTFS cache works per-user (localStorage)

## Future Enhancements to Consider
1. Service alerts integration
2. Walking time to terminal
3. Favorite routes
4. Push notifications for imminent departures
5. Historical reliability data