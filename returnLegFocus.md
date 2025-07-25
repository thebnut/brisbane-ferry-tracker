# Return Leg Focus Feature

## Overview
This feature automatically switches the mobile tab view to show the return journey (inbound) after 12:30 PM, assuming users are more likely to be looking for their return trip in the afternoon.

## Current Implementation (Re-added January 2025 as optional feature)

### Location
- `src/components/StopSelectorModal.jsx` - Toggle UI and state management
- `src/App.jsx` - `getDefaultTab()` function and preference handling
- `src/utils/constants.js` - Storage key definition

### How it works
1. Feature is hidden by default
2. Only visible when "Remember selection" is turned ON
3. User can enable "Reverse direction after lunch" toggle
4. When enabled, the app switches to inbound tab after 12:30 PM
5. Preference is saved to localStorage only when remember is enabled

### UI/UX
- Toggle appears conditionally in "Regular Commuter Settings" section
- Help text: "The main view will show the reverse direction after 12:30pm each day."
- Automatically disabled when "Remember selection" is turned OFF

## Previous Implementation (Removed January 2025)

### Location
`src/App.jsx` - `getDefaultTab()` function

### Code
```javascript
// Determine default tab based on time of day
const getDefaultTab = () => {
  const now = new Date();
  const brisbanTime = toZonedTime(now, 'Australia/Brisbane');
  const hours = brisbanTime.getHours();
  const minutes = brisbanTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  
  // After 12:30 PM (750 minutes) until midnight, default to inbound
  return totalMinutes >= 750 ? 'inbound' : 'outbound';
};
```

### Dependencies
- `import { toZonedTime } from 'date-fns-tz';` (already imported in App.jsx)

### Logic
1. Get current Brisbane time using `toZonedTime`
2. Calculate total minutes since midnight (hours * 60 + minutes)
3. If totalMinutes >= 750 (12:30 PM), return 'inbound'
4. Otherwise return 'outbound'

## Future Implementation Considerations

### 1. Make it User-Configurable
Consider adding a settings option to:
- Enable/disable automatic tab switching
- Set custom switchover time
- Remember user's manual tab selection

### 2. Smarter Logic
Could enhance with:
- Weekend vs weekday different times
- Public holiday awareness
- User journey patterns (learn from usage)

### 3. Implementation Options

#### Option A: Settings Toggle
```javascript
const getDefaultTab = () => {
  const autoSwitchEnabled = localStorage.getItem('autoTabSwitch') !== 'false';
  
  if (!autoSwitchEnabled) {
    return 'outbound';
  }
  
  // Original time-based logic here
};
```

#### Option B: Custom Time Setting
```javascript
const getDefaultTab = () => {
  const switchTime = localStorage.getItem('tabSwitchTime') || '12:30';
  const [hours, minutes] = switchTime.split(':').map(Number);
  const switchMinutes = hours * 60 + minutes;
  
  // Compare with current time logic
};
```

#### Option C: Smart Default with Override
```javascript
const getDefaultTab = () => {
  // Check if user has manually selected a tab in this session
  const userSelection = sessionStorage.getItem('userTabSelection');
  if (userSelection) return userSelection;
  
  // Otherwise use time-based logic
  // ... original implementation
};
```

## User Experience Notes
- Some users found automatic switching confusing
- Others appreciated the convenience
- Best approach likely involves user choice/settings

## Related Files
- `src/App.jsx` - Main implementation
- `src/utils/constants.js` - Could add setting keys here
- Future: Settings modal component for user preferences