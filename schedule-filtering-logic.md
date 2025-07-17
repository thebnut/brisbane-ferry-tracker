# Ferry Schedule Filtering Logic

## The Problem

When displaying ferry departures between two specific terminals (Bulimba ⟷ Riverside), we need to ensure we're only showing ferries that actually travel FROM one terminal TO the other. 

Simply showing all ferries that stop at both terminals is insufficient because a ferry might:
- Stop at Riverside first, then Bulimba (but we'd incorrectly show it as Bulimba→Riverside)
- Stop at one terminal but be terminating there (not continuing to the other)

## Key Insight: Brisbane Ferry Routes Are Not Circular

Brisbane ferry routes are linear with terminating endpoints. This means:
- A ferry that has already been to Riverside won't go there again on the same trip
- Routes don't loop back to previous stops
- Each trip has a clear direction of travel

## The Filtering Solution

### Step 1: Initial Route Filtering
Filter trips that:
1. Are on relevant routes (F1 or F11)
2. Include BOTH Bulimba AND Riverside in their stop sequence

```javascript
const hasBulimba = stopTimeUpdates.some(update => update.stopId === STOPS.bulimba);
const hasRiverside = stopTimeUpdates.some(update => update.stopId === STOPS.riverside);
return isRelevantRoute && hasBulimba && hasRiverside;
```

### Step 2: Direction-Specific Filtering
For each departure, check the remaining stops in the journey:

```javascript
checkDestination(currentStopId, allStopTimes, currentIndex) {
  const remainingStops = allStopTimes.slice(currentIndex + 1);
  
  if (currentStopId === STOPS.bulimba) {
    // For Bulimba → Riverside: Riverside must appear later
    return remainingStops.some(stop => stop.stopId === STOPS.riverside);
  } else if (currentStopId === STOPS.riverside) {
    // For Riverside → Bulimba: Bulimba must appear later
    return remainingStops.some(stop => stop.stopId === STOPS.bulimba);
  }
}
```

## Examples

### Correct Filtering

**Route: Hamilton → Riverside → Bulimba → Teneriffe**
- At Riverside stop: ✅ Shows in "Riverside → Bulimba" (Bulimba comes next)
- At Bulimba stop: ❌ Does NOT show in "Bulimba → Riverside" (Riverside already passed)

**Route: Teneriffe → Bulimba → Riverside → Hamilton**
- At Bulimba stop: ✅ Shows in "Bulimba → Riverside" (Riverside comes next)
- At Riverside stop: ❌ Does NOT show in "Riverside → Bulimba" (Bulimba already passed)

### Edge Cases Handled

1. **Express services that skip stops**: Still works as we only check for our two terminals
2. **Services terminating at one terminal**: Won't show if they don't continue to the other
3. **Multiple stops with same ID**: Not an issue as routes are linear

## Why This Approach?

### Alternatives Considered

1. **Check previous stops**: Would work but unnecessarily complex for non-circular routes
2. **Use trip headsign**: Unreliable as headsigns may not indicate intermediate stops
3. **Time-based filtering**: Wouldn't work for routes with varying speeds

### Benefits of Current Approach

1. **Simple**: Just check if destination appears in remaining stops
2. **Accurate**: Guarantees ferry actually travels in the shown direction
3. **Efficient**: O(n) check for each departure
4. **Maintainable**: Easy to understand and modify

## Implementation Details

### Real-time Data (ferryData.js)
- Filters GTFS-RT trip updates
- Applies both initial and direction filtering
- Merges with static schedule data

### Static Schedule Data (staticGtfsService.js)
- Parses GTFS stop_times.txt
- Applies same filtering logic
- Caches results for 24 hours

### Data Flow
1. Fetch all trips containing both terminals
2. For each stop at Bulimba/Riverside:
   - Check if the other terminal appears later in the route
   - If yes, include in appropriate departure board
   - If no, skip this departure

## Testing the Logic

To verify filtering is working correctly:

1. Look for ferries that appear in only ONE direction board
2. Check console logs for "Not a direct service" messages
3. Compare with TransLink journey planner
4. Verify early morning shows scheduled times

## Future Considerations

If Brisbane ferries become circular routes:
1. Would need to track if we've "already been" to the destination
2. Might need to consider trip direction indicators
3. Could use first/last occurrence of stops to determine direction

Current implementation assumes routes remain linear and terminating.