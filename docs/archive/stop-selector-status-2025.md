# Dynamic Stop Selector Implementation - Current Status

## What We've Built

### 1. Schedule Processor Enhancement
Modified `schedule-processor/process-schedule.js` to generate ferry stop connectivity data:
- Filters for 19 Brisbane ferry terminals only
- Generates `ferryStops` object with names, coordinates, and valid destinations
- Generates `stopConnectivity` mapping showing which stops connect directly
- Outputs to `schedule-data/latest.json`

### 2. Frontend Components

#### StopSelectorModal
- Allows users to select origin/destination stops
- Dynamic filtering - destination dropdown only shows stops with direct ferry connections
- LocalStorage persistence - saves selected stops
- First-visit detection - shows modal automatically for new users

#### Updated Components
- `Navigation.jsx` - Shows selected stops and settings gear icon
- `DepartureBoard.jsx` - Displays dynamic stop names
- `FerryDetailsModal.jsx` - Uses selected stops for journey info
- `App.jsx` - Manages selected stops state and persistence

### 3. Data Service Updates

#### ferryData.js
- Filters trips based on selected stops
- Validates trips go from origin to destination (not reverse)
- Supports all ferry routes (not just F1/F11)

#### staticGtfsService.js
- Parses ferry stops from schedule data
- Provides methods: `getAvailableStops()`, `getValidDestinations()`, `getStopInfo()`
- Falls back to temporary data if schedule not available

## Current Issues on Vercel

The Vercel deployment isn't working because:

1. **Schedule Data Not Available**: The app needs the generated `latest.json` with ferry stop connectivity data
2. **GitHub Pages Not Configured**: The schedule data needs to be served from GitHub Pages at `https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/latest.json`

## Steps to Fix Vercel Deployment

### 1. Enable GitHub Pages
- Go to https://github.com/thebnut/brisbane-ferry-tracker/settings/pages
- Set Source: "Deploy from a branch"
- Set Branch: "main" and "/ (root)"
- Click Save

### 2. Run GitHub Action
- Go to https://github.com/thebnut/brisbane-ferry-tracker/actions
- Click "Update Ferry Schedule"
- Run workflow manually
- This generates the schedule data with ferry stop connectivity

### 3. Wait for GitHub Pages
It takes a few minutes for GitHub Pages to deploy

### 4. Verify Data Access
Check that https://thebnut.github.io/brisbane-ferry-tracker/schedule-data/latest.json is accessible

## Expected Behavior Once Fixed

Once these steps are complete, the Vercel deployment at https://brisbane-ferry-tracker.vercel.app/ will:
- Load the ferry stops data from GitHub Pages
- Show the stop selector modal on first visit
- Allow users to select any ferry terminal pair
- Display correct departures for the selected route
- Show live status when real-time data is available

## Key Files for Reference

### Backend/Processing
- `schedule-processor/process-schedule.js` - Generates connectivity data
- `.github/workflows/update-schedule.yml` - Daily schedule updates

### Frontend Components
- `src/components/StopSelectorModal.jsx` - Stop selection UI
- `src/utils/ferryStops.js` - Temporary fallback ferry stop data

### Data Services
- `src/services/ferryData.js` - Filters departures for selected stops
- `src/services/staticGtfsService.js` - Loads and parses ferry stop data

### Configuration
- `src/utils/constants.js` - Storage keys and default stops

## Recent Debug Findings

### Live Status Display Issue
- Discovered that "Scheduled" vs "LIVE" display depends on real-time departure data
- Real-time feed may only provide departure updates for certain stops
- Modal shows "LIVE" if trip has any real-time data (position, occupancy)
- Departure board shows "LIVE" only if that specific stop has real-time departure data

### Data Flow
1. Schedule processor generates all ferry departures (9,356 total)
2. Client filters to show only trips between selected stops
3. Real-time data merges with scheduled data
4. Display shows appropriate status based on data availability