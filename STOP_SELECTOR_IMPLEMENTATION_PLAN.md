# Master Plan: Dynamic Origin/Destination Ferry Stop Selection

## Overview
Transform the Brisbane Ferry Tracker from a fixed Bulimba-Riverside tracker to a flexible ferry tracker that allows users to select any two ferry stops, with smart filtering to only show direct connections.

## Phase 1: Schedule Processor Enhancement (Backend)

### 1.1 Modify schedule-processor/process-schedule.js

**Add Stop Connectivity Data Generation:**

1. **Parse stops.txt** to extract all ferry stops:
   - Filter stops that are used by ferry routes (F1, F11, etc.)
   - Extract stop ID, name, and coordinates
   
2. **Build Stop Connectivity Map:**
   ```javascript
   // For each ferry route, determine which stops connect directly
   const stopConnectivity = {};
   const routeStopSequences = {};
   
   // Process each trip to find stop patterns
   for (const trip of trips) {
     if (trip.route_id.startsWith('F')) {
       const stopSequence = getStopSequenceForTrip(trip.trip_id);
       const routeKey = `${trip.route_id}-${trip.direction_id}`;
       
       if (!routeStopSequences[routeKey]) {
         routeStopSequences[routeKey] = new Set();
       }
       
       // Add all stops in sequence
       stopSequence.forEach(stop => routeStopSequences[routeKey].add(stop.stop_id));
     }
   }
   
   // Build connectivity lookup: origin -> [valid destinations]
   for (const [routeKey, stops] of Object.entries(routeStopSequences)) {
     const stopArray = Array.from(stops);
     
     stopArray.forEach((originStop, originIndex) => {
       if (!stopConnectivity[originStop]) {
         stopConnectivity[originStop] = new Set();
       }
       
       // Add all stops after this one as valid destinations
       for (let i = originIndex + 1; i < stopArray.length; i++) {
         stopConnectivity[originStop].add(stopArray[i]);
       }
     });
   }
   ```

3. **Update latest.json structure:**
   ```json
   {
     "generated": "2025-07-18T01:31:59.755Z",
     "timezone": "Australia/Brisbane",
     "validFrom": "...",
     "validTo": "...",
     "departureCount": 247,
     "departures": [...],
     "ferryStops": {
       "317584": {
         "name": "Bulimba",
         "lat": -27.4447,
         "lng": 153.0576,
         "validDestinations": ["317590", "317533", "..."]
       },
       "317590": {
         "name": "Riverside",
         "lat": -27.4747,
         "lng": 153.0177,
         "validDestinations": ["317584", "317521", "..."]
       }
       // ... all ferry stops
     },
     "stopConnectivity": {
       "317584": ["317590", "317533", "..."],
       "317590": ["317584", "317521", "..."]
       // ... for each stop, list of reachable stops
     }
   }
   ```

### 1.2 Update GitHub Actions Workflow
- Ensure the new data structure is properly generated
- Test that file size remains reasonable (estimate: +30-50KB)

## Phase 2: Frontend Infrastructure Updates

### 2.1 Create Constants and Types

**Update src/utils/constants.js:**
```javascript
// Add localStorage key
export const STORAGE_KEYS = {
  SCHEDULE_CACHE: 'brisbane-ferry-schedule-cache',
  SELECTED_STOPS: 'brisbane-ferry-selected-stops'
};

// Default stops for backward compatibility
export const DEFAULT_STOPS = {
  outbound: {
    id: STOPS.bulimba,
    name: 'Bulimba'
  },
  inbound: {
    id: STOPS.riverside,
    name: 'Riverside'
  }
};
```

### 2.2 Update Data Services

**Modify src/services/staticGtfsService.js:**
1. Parse the new `ferryStops` data from latest.json
2. Create methods:
   - `getAvailableStops()` - Returns all ferry stops
   - `getValidDestinations(originStopId)` - Returns valid destinations for a stop
   - `getStopInfo(stopId)` - Returns stop name and coordinates

**Modify src/services/ferryData.js:**
1. Update `filterRelevantTrips` to accept custom stop IDs
2. Modify direction logic to work with any stop pair
3. Update `checkDestination` to use custom stops

### 2.3 Create Stop Selector Modal

**New file: src/components/StopSelectorModal.jsx:**
```javascript
const StopSelectorModal = ({ isOpen, onClose, currentStops, onSave }) => {
  const [selectedOrigin, setSelectedOrigin] = useState(currentStops.outbound.id);
  const [selectedDestination, setSelectedDestination] = useState(currentStops.inbound.id);
  const [availableStops, setAvailableStops] = useState([]);
  const [validDestinations, setValidDestinations] = useState([]);
  
  // Load stops on mount
  useEffect(() => {
    const stops = staticGtfsService.getAvailableStops();
    setAvailableStops(stops);
  }, []);
  
  // Update valid destinations when origin changes
  useEffect(() => {
    const destinations = staticGtfsService.getValidDestinations(selectedOrigin);
    setValidDestinations(destinations);
    
    // Reset destination if not valid for new origin
    if (!destinations.includes(selectedDestination)) {
      setSelectedDestination(destinations[0]?.id || '');
    }
  }, [selectedOrigin]);
  
  // Modal UI with:
  // - Origin dropdown (all stops)
  // - Destination dropdown (only valid direct connections)
  // - Visual route preview
  // - Save/Cancel buttons
};
```

## Phase 3: UI Component Updates

### 3.1 Update App.jsx
```javascript
function App() {
  // Load saved stops or use defaults
  const [selectedStops, setSelectedStops] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
    return saved ? JSON.parse(saved) : DEFAULT_STOPS;
  });
  
  const [showStopSelector, setShowStopSelector] = useState(() => {
    // Show selector on first visit
    return !localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
  });
  
  // Pass selected stops to useFerryData
  const { departures, ... } = useFerryData(selectedStops);
  
  // Save stops when changed
  const handleStopChange = (newStops) => {
    setSelectedStops(newStops);
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, JSON.stringify(newStops));
    setShowStopSelector(false);
  };
  
  // Add settings gear icon to open modal
}
```

### 3.2 Update Component Props

**Navigation.jsx:**
- Accept `selectedStops` prop
- Display dynamic stop names instead of "Bulimba ⟷ Riverside"

**DepartureBoard.jsx:**
- Accept `selectedStops` prop
- Update `getTitle()` to use custom stop names

**FerryDetailsModal.jsx:**
- Accept `selectedStops` prop
- Update destination logic and display text

**FerryMap.jsx:**
- Accept `selectedStops` and `ferryStops` data
- Update terminal markers to show selected stops
- Get coordinates from ferryStops data

### 3.3 Update Mobile Tabs
- Change "To Riverside" → `To ${selectedStops.inbound.name}`
- Change "To Bulimba" → `To ${selectedStops.outbound.name}`

## Phase 4: Testing and Edge Cases

### 4.1 Test Scenarios
1. **First-time user**: Modal appears, can select stops
2. **Returning user**: Previously selected stops are remembered
3. **Invalid route**: Selecting origin limits destination options
4. **Stop changes**: All UI updates correctly
5. **Data refresh**: New schedule data respects selected stops

### 4.2 Edge Cases to Handle
1. User has saved stops that no longer have service
2. Schedule update changes available connections
3. Mobile responsive design for stop selector
4. Accessibility for dropdown navigation

## Phase 5: Deployment Strategy

1. **Deploy schedule processor changes first**
   - Test with current frontend (should be backward compatible)
   - Verify new data structure is correct

2. **Deploy frontend changes**
   - Soft launch with settings gear icon
   - Monitor for issues
   - Consider A/B testing if needed

## Implementation Order

1. **Start with Phase 1** - Schedule processor enhancement
   - This is backward compatible and can be deployed independently
   - Provides the data foundation for the frontend changes

2. **Then Phase 2** - Frontend infrastructure
   - Build the core services and modal component
   - Test with mock data if schedule processor not ready

3. **Then Phase 3** - UI updates
   - Update all components to use dynamic stops
   - Ensure backward compatibility with default stops

4. **Finally Phase 4 & 5** - Testing and deployment
   - Comprehensive testing of all scenarios
   - Staged rollout to minimize risk

## Benefits of This Approach

1. **Performance**: Stop connectivity pre-computed during schedule processing
2. **User Experience**: Only shows valid direct connections
3. **Flexibility**: Easy to extend to multi-stop journeys later
4. **Backward Compatible**: Defaults to Bulimba-Riverside
5. **Offline Capable**: All data cached locally

## Future Enhancements

1. **Multi-leg journeys**: Show connections with transfers
2. **Favorite routes**: Save multiple origin-destination pairs
3. **URL sharing**: Share specific routes via URL parameters
4. **Stop popularity**: Show most-used stop pairs

## Technical Considerations

### Performance Impact
- Schedule processor: +10-20 seconds processing time
- File size: +30-50KB for stop data
- Client load: Minimal, data is pre-computed

### Browser Support
- LocalStorage: All modern browsers
- Modal: Standard React patterns
- Dropdowns: Native HTML select for accessibility

### Mobile Considerations
- Touch-friendly dropdown controls
- Responsive modal design
- Gesture support for modal dismissal

### Accessibility
- Keyboard navigation for all controls
- ARIA labels for screen readers
- Focus management in modal
- High contrast support