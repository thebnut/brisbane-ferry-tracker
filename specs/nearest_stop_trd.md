# Technical Requirements Document: Nearest Stop Feature

## Technical Specification

### Architecture Overview
The feature will integrate into the existing StopSelectorModal and StopSelectorMap components, adding geolocation capabilities without disrupting current functionality.

### Core Components

#### 1. New Utility Module: `src/utils/geolocation.js`
- **calculateDistance(lat1, lng1, lat2, lng2)**: Haversine formula for distance calculation
- **findNearestStop(userLocation, stops)**: Returns nearest stop with distance
- **getUserLocation()**: Promise-based wrapper for geolocation API
- **formatDistance(meters)**: Format distance for display (m/km)

#### 2. Enhanced StopSelectorMap Component
- Add "Nearest Stop" button with location icon
- Display user location marker (blue pulsing dot)
- Highlight nearest stop with special styling
- Show distance in popup/tooltip
- Auto-center map on user location when activated

#### 3. State Management Updates
- Add state for user location coordinates
- Add state for nearest stop calculation
- Add loading state for geolocation request
- Add error state for permission/availability issues

### Technical Requirements

#### Browser API Integration
```javascript
// Geolocation options for accuracy
const geoOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000 // Cache for 1 minute
};
```

#### Distance Calculation Algorithm
```javascript
// Haversine formula for accurate distance calculation
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lng2-lng1) * Math.PI/180;
  
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c; // Distance in meters
}
```

#### UI Components
- **Button Placement**: Top-right of map container, adjacent to map controls
- **User Location Marker**: Blue pulsing circle with white border
- **Nearest Stop Highlight**: Green border with animation
- **Distance Display**: Badge showing "XXm" or "X.Xkm"

### Data Flow
1. User clicks "Nearest Stop" button
2. Request geolocation permission
3. Get user coordinates
4. Calculate distances to all stops
5. Identify nearest stop
6. Update map display
7. Show stop details with distance

## Implementation Plan

### Phase 1: Core Geolocation Module (Day 1)
**Files to create:**
- `src/utils/geolocation.js`

**Tasks:**
1. Implement calculateDistance function with Haversine formula
2. Create getUserLocation promise wrapper
3. Implement findNearestStop function
4. Add formatDistance utility
5. Create error handling utilities
6. Write unit tests for distance calculations

### Phase 2: Map Integration (Day 1-2)
**Files to modify:**
- `src/components/StopSelectorMap.jsx`
- `src/components/StopSelectorModal.jsx`

**Tasks:**
1. Add "Nearest Stop" button to StopSelectorMap
2. Implement state management for user location
3. Add user location marker to map
4. Implement nearest stop highlighting
5. Add distance display to stop popups
6. Handle map centering and zoom

### Phase 3: User Experience Enhancements (Day 2)
**Files to modify:**
- `src/components/StopSelectorMap.jsx`
- `src/index.css` (if custom animations needed)

**Tasks:**
1. Add loading state during geolocation request
2. Implement error messages for permission denial
3. Add smooth animations for map transitions
4. Create pulsing animation for user location marker
5. Add keyboard accessibility (Space/Enter to activate)
6. Implement mobile-responsive button placement

### Phase 4: Error Handling & Edge Cases (Day 2-3)
**Files to modify:**
- `src/utils/geolocation.js`
- `src/components/StopSelectorMap.jsx`

**Tasks:**
1. Handle geolocation unavailable (HTTP context)
2. Handle permission denied gracefully
3. Handle timeout scenarios
4. Implement fallback for no stops within 5km
5. Add retry mechanism for failed requests
6. Clear error messages on successful retry

### Phase 5: Analytics & Performance (Day 3)
**Files to modify:**
- `src/components/StopSelectorMap.jsx`
- `src/utils/constants.js` (add analytics events)

**Tasks:**
1. Add analytics event tracking
2. Implement performance monitoring
3. Add console logging for debugging
4. Optimize re-render behavior
5. Test on various devices/browsers

### Phase 6: Testing & Documentation (Day 3)
**Files to create/modify:**
- `specs/nearest_stop_trd.md` (this document)
- Update `CLAUDE.md` with feature documentation

**Tasks:**
1. Manual testing on desktop browsers
2. Mobile testing (iOS Safari, Chrome Android)
3. Test permission flows
4. Test error scenarios
5. Update technical documentation
6. Add feature to CLAUDE.md

## Compatibility Considerations

### Existing Code Integration
- No breaking changes to existing stop selection flow
- Feature is additive - existing functionality unchanged
- Uses existing Leaflet map instance
- Leverages existing stop data structure
- Follows current UI/UX patterns (orange theme)

### Browser Support
- Chrome 50+ ✅
- Safari 10+ ✅
- Firefox 55+ ✅
- Edge 79+ ✅
- Mobile browsers with GPS ✅

### Privacy & Security
- No data storage beyond session
- No external API calls for location
- Permission request only on user action
- Clear permission messaging
- No tracking/analytics of actual location

### Performance Impact
- Minimal - only active when button clicked
- Distance calculations are O(n) for ~20 stops
- No continuous location watching
- Cached location for 1 minute
- No impact on initial page load

## File Structure Changes
```
src/
├── utils/
│   ├── geolocation.js (NEW)
│   └── constants.js (MODIFIED - add geo constants)
├── components/
│   ├── StopSelectorMap.jsx (MODIFIED)
│   └── StopSelectorModal.jsx (MODIFIED - minor)
└── index.css (POTENTIALLY MODIFIED - animations)
```

## API Specifications

### Geolocation Module API

```javascript
// src/utils/geolocation.js

/**
 * Get user's current location
 * @returns {Promise<{lat: number, lng: number}>}
 * @throws {Error} Permission denied, timeout, or unavailable
 */
export async function getUserLocation(options = {})

/**
 * Calculate distance between two coordinates
 * @param {number} lat1 - First latitude
 * @param {number} lng1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lng2 - Second longitude
 * @returns {number} Distance in meters
 */
export function calculateDistance(lat1, lng1, lat2, lng2)

/**
 * Find nearest stop from user location
 * @param {{lat: number, lng: number}} userLocation
 * @param {Array<{id: string, lat: number, lng: number, name: string}>} stops
 * @returns {{stop: Object, distance: number}}
 */
export function findNearestStop(userLocation, stops)

/**
 * Format distance for display
 * @param {number} meters
 * @returns {string} Formatted distance (e.g., "150m", "1.2km")
 */
export function formatDistance(meters)
```

### Component Props Updates

```javascript
// StopSelectorMap additions
<StopSelectorMap
  // Existing props...
  showNearestStop={boolean}
  onNearestStopRequest={function}
  userLocation={{lat, lng} | null}
  nearestStop={{id, distance} | null}
/>
```

## Testing Checklist
- [ ] Desktop: Chrome, Safari, Firefox, Edge
- [ ] Mobile: iOS Safari, Chrome Android
- [ ] Permission granted flow
- [ ] Permission denied flow
- [ ] Location unavailable (HTTP)
- [ ] No stops within 5km
- [ ] Timeout handling
- [ ] Multiple clicks handling
- [ ] Map interaction after location
- [ ] Accessibility (keyboard, screen reader)

## Success Metrics
- Feature usage rate > 30% of map opens
- Success rate > 90% for location retrieval
- Average time to nearest stop < 3 seconds
- Zero performance regression on page load
- No increase in error rates

## Risk Assessment

### Technical Risks
1. **Browser Compatibility**: Older browsers may not support geolocation
   - Mitigation: Feature detection and graceful degradation
   
2. **Permission Fatigue**: Users may deny location access
   - Mitigation: Clear value proposition in UI, allow manual selection

3. **Accuracy Issues**: GPS accuracy varies by device/location
   - Mitigation: Show accuracy radius, allow manual correction

### Privacy Risks
1. **User Trust**: Location data is sensitive
   - Mitigation: Clear privacy messaging, no data retention
   
2. **HTTPS Requirement**: Geolocation requires secure context
   - Mitigation: Already deployed on HTTPS domains

## Dependencies
- Leaflet 1.9.4 (existing)
- React-Leaflet 5.0.0 (existing)
- Browser Geolocation API (native)
- No new npm packages required

## Rollout Strategy
1. Deploy to develop branch for testing
2. Test on brisbane-ferry-tracker.vercel.app
3. Gather feedback from beta users
4. Deploy to main branch
5. Monitor analytics and error rates
6. Iterate based on user feedback

## Future Enhancements
1. Walking directions to nearest stop
2. Multiple nearest stops (top 3)
3. Filter by accessible stops only
4. Save favorite locations
5. Offline detection of nearest stop
6. Integration with device compass for direction