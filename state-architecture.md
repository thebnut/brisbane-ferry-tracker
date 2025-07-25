# Brisbane Ferry Tracker - State Architecture

## Overview

The Brisbane Ferry Tracker uses a two-tier state management system for handling stop selections. This architecture ensures a smooth user experience while providing both persistence and flexibility.

## State Types

### 1. Persisted State (`selectedStops`)
- **Purpose**: Stores the user's saved stop selection
- **Storage**: 
  - `localStorage` when "Remember selection" is enabled
  - `sessionStorage` when "Remember selection" is disabled
- **Usage**: Used as the initial value for `temporaryStops` on page load
- **Updates**: Only updated when user saves from the Stop Selector Modal

### 2. Temporary State (`temporaryStops`)
- **Purpose**: Manages the current active stop selection during a session
- **Storage**: React state (memory only)
- **Usage**: **Always drives the UI display**
- **Updates**: 
  - Changed via dropdown selectors
  - Changed via reverse direction button
  - Reset to `selectedStops` when modal saves

## State Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        State Management                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. PERSISTED STATE (selectedStops)                            │
│     └─> Stored in localStorage if "Remember selection" = true   │
│     └─> Used only as initial value for temporaryStops          │
│                                                                  │
│  2. TEMPORARY STATE (temporaryStops)                           │
│     └─> Session-based (lives as long as page is open)          │
│     └─> ALWAYS drives the UI display                           │
│     └─> Initialized from selectedStops on page load            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## User Interactions

### Page Load
```javascript
const [temporaryStops, setTemporaryStops] = useState(selectedStops);
```
- `temporaryStops` is initialized with the value of `selectedStops`
- All UI components use `currentStops` which equals `temporaryStops || selectedStops`

### Stop Selector Modal Save
```javascript
const handleStopChange = (newStops, rememberSelection) => {
  setSelectedStops(newStops);      // Update persisted state
  setTemporaryStops(newStops);     // Update temporary state
  // ... localStorage/sessionStorage logic
}
```
- Both states are updated to maintain consistency
- Persistence behavior depends on "Remember selection" toggle

### Dropdown Changes
```javascript
const handleTemporaryOriginChange = (originId) => {
  // ... validation logic
  setTemporaryStops({
    outbound: { id: originId, name: originStop.name },
    inbound: destinationStop
  });
}
```
- Only `temporaryStops` is updated
- `selectedStops` remains unchanged (preserving user's saved preference)

### Reverse Direction Button
```javascript
const handleSwitchDirection = () => {
  setTemporaryStops({
    outbound: currentStops.inbound,
    inbound: currentStops.outbound
  });
}
```
- Simply swaps the outbound/inbound values in `temporaryStops`
- No tab switching on mobile (always shows outbound)

## Display Logic

### Mobile View
- Shows single departure board (always outbound direction)
- Header contains dropdown selectors and reverse button
- Direction determined by `temporaryStops`

### Desktop View
- Shows both departure boards side by side
- Outbound board: `temporaryStops.outbound → temporaryStops.inbound`
- Inbound board: `temporaryStops.inbound → temporaryStops.outbound`
- Both boards update when `temporaryStops` changes

## Key Principles

1. **UI Always Uses `temporaryStops`**: The display is always driven by temporary state
2. **Persisted State is Secondary**: Only used for initialization and storage
3. **State Synchronization**: When modal saves, both states are updated together
4. **Session Flexibility**: Users can experiment with different routes without losing their saved preference
5. **Mobile Simplicity**: Mobile never changes tabs, only reverses the direction

## Common Issues and Solutions

### Issue: State Reverting After Direction Change
**Cause**: `temporaryStops` was initialized as `null` instead of `selectedStops`
**Solution**: Always initialize `temporaryStops` with `selectedStops`

### Issue: Header Not Updating
**Cause**: Components using `selectedStops` instead of `currentStops`
**Solution**: All components should use `currentStops` (which references `temporaryStops`)

### Issue: Data Refresh Clearing Temporary State
**Cause**: Re-renders or data fetching resetting state
**Solution**: Ensure `temporaryStops` is only modified by explicit user actions