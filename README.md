# Brisbane Ferry Tracker

A real-time ferry departure tracker for Brisbane's ferry network, allowing users to track services between any two ferry terminals. Built with React, Vite, and Tailwind CSS.

## Features

- 🚤 Live departure times for all Brisbane ferry services (CityCat, CityHopper, Cross River)
- 🎯 Dynamic stop selector - choose any ferry terminal pair
- ⏱️ Real-time countdown timers for next departures
- 📅 Shows scheduled times when real-time data unavailable (early mornings)
- 🗓️ Tomorrow's departures show date (DD/MM) for clarity
- 🔄 Auto-refresh every 5 minutes with smart cache validation
- 🎛️ Service filters (All/Express) in header bar, hidden when no express services
- 🗺️ Interactive map showing live ferry positions with pulsing markers
- 📱 Fully responsive design with mobile-optimized tabs
- ⚡ Progressive loading - see live ferries instantly while schedule loads
- 📊 "More..." button to expand from 5 to 13 departures per direction
- 🚢 Clean interface - stop names without "ferry terminal" suffix
- 🏷️ Ferry vessel names displayed (e.g., "Mooroolbin II")
- 🟢 Separate LIVE and GPS status badges
- 🕐 Shows scheduled departure time for on-time ferries
- 📢 Dynamic status messages based on available data
- ⚙️ Settings gear to change selected stops anytime

## Tech Stack

- **Frontend**: React 19 + Vite
- **Styling**: Tailwind CSS v3
- **Data Source**: TransLink GTFS-RT (Real-time Transit Feed)
- **Deployment**: Vercel
- **Key Libraries**: 
  - `gtfs-realtime-bindings` - For parsing GTFS protobuf data
  - `date-fns` & `date-fns-tz` - For time calculations and timezone handling
  - `react-leaflet` - Interactive ferry position maps
  - `clsx` - For conditional styling
  - `jszip` - For processing GTFS schedule files
  - `papaparse` - For parsing CSV data from GTFS

## Development

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Setup

1. Clone the repository:
```bash
git clone [repo-url]
cd brisbane-ferry-tracker
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Environment Variables

Create a `.env.local` file for local development:

```env
VITE_GTFS_API_BASE=https://gtfsrt.api.translink.com.au/api/realtime/SEQ/
```

## Deployment

### Deploy to Vercel (Recommended - Full Features)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

**Features**: 
- ✅ Live ferry tracking
- ✅ Real-time updates
- ✅ CORS proxy for TransLink API
- ✅ Full functionality

The app includes serverless functions to handle CORS for the TransLink API.

### Deploy to GitHub Pages (Schedule Only)

The app is also deployed to GitHub Pages, but with limited functionality:

**Features**:
- ✅ Schedule data (updated daily)
- ❌ No live ferry tracking (CORS limitation)
- ❌ No real-time updates

**URL**: https://thebnut.github.io/brisbane-ferry-tracker/

### Manual Deployment

1. Build the project:
```bash
npm run build
```

2. The `dist` folder contains the static files ready for deployment to any static hosting service.

**Note**: Without a CORS proxy, only schedule data will be available.

## Project Structure

```
src/
├── components/          # React components
│   ├── Navigation.jsx   # App header with stop selector
│   ├── StatusBar.jsx    # Update status, filters, map & refresh
│   ├── DepartureBoard.jsx # Direction-specific departures
│   ├── DepartureItem.jsx  # Individual ferry display
│   ├── FerryMap.jsx    # Live ferry positions map
│   ├── FerryDetailsModal.jsx # Detailed ferry info modal
│   ├── StopSelectorModal.jsx # Terminal selection
│   └── ...
├── services/           # API and data services
│   ├── gtfsService.js  # GTFS-RT data fetching
│   ├── staticGtfsService.js # Static schedule data
│   └── ferryData.js    # Data filtering & merging logic
├── hooks/              # Custom React hooks
│   └── useFerryData.js # Ferry data management
├── utils/              # Constants and helpers
│   └── constants.js    # Stop IDs, routes, config
└── App.jsx            # Main app component
```

## Technical Documentation

- [CLAUDE.md](./CLAUDE.md) - Development guide for AI assistants
- [app-architecture.md](./app-architecture.md) - Detailed system architecture and data flow
- [schedule-filtering-logic.md](./schedule-filtering-logic.md) - Detailed explanation of ferry filtering algorithm

## How It Works

### Progressive Loading
The app uses a two-stage loading approach for optimal user experience:
1. **Immediate Display**: Real-time ferry data loads first, showing live departures instantly
2. **Background Loading**: Schedule data loads in the background and merges seamlessly

### Data Sources
The app combines multiple data sources for comprehensive coverage:

1. **Pre-processed Schedule** (Primary): Daily generated schedule data hosted on GitHub Pages
   - Processed daily at 3 AM Brisbane time via GitHub Actions
   - Includes all ferry stops and connectivity data
   - Smart cache validation ensures bug fixes are delivered immediately
   
2. **Real-time GTFS-RT**: Shows live ferry positions and delays (only available for actively running services)

3. **Static GTFS Schedule** (Fallback): Full timetable data processed client-side if GitHub data unavailable

### Ferry Filtering
The app intelligently filters ferry services to show only those traveling between your selected terminals:

- ✅ Shows: Ferries departing your origin that will arrive at your destination
- ✅ Shows: Ferries departing your destination that will arrive at your origin  
- ❌ Excludes: Ferries that stop at one terminal but don't continue to the other
- ❌ Excludes: Ferries traveling in the opposite direction (e.g., already been to destination)

Key features:
- **TripId-based tracking**: Each ferry journey is uniquely identified
- **Stop sequence ordering**: Ensures correct direction determination
- **Smart merging**: Matches real-time updates with scheduled times using tripId

## Application Architecture

The Brisbane Ferry Tracker uses a sophisticated data pipeline to deliver real-time ferry information:

### Data Flow Overview

```
TransLink APIs → Processing → Frontend Display
```

1. **Schedule Data Pipeline**:
   - GitHub Actions runs daily at 3 AM Brisbane time
   - Downloads full GTFS ZIP (30MB) from TransLink
   - Processes and filters ferry-only data
   - Generates optimized JSON (3MB) with next 48 hours of departures
   - Publishes to GitHub Pages CDN for fast, reliable access

2. **Real-time Data Pipeline**:
   - Frontend fetches GTFS-RT updates every 5 minutes
   - Vercel proxy handles CORS for TransLink API
   - Protobuf data parsed client-side
   - Live positions and delays merged with schedule

3. **Progressive Loading Strategy**:
   - Real-time data loads first (< 1 second)
   - Schedule data loads in background
   - Users see live ferries immediately
   - Schedule fills in gaps seamlessly

### Key Architecture Decisions

- **Pre-processed Schedules**: Reduces client processing from 30MB to 3MB
- **Smart Caching**: Validates GitHub timestamp before using cached data
- **Dynamic Stop Selection**: All processing adapts to user-selected terminals
- **Two-stage Loading**: Optimizes perceived performance

For detailed architecture documentation, see [app-architecture.md](./app-architecture.md).

## API Integration

The app uses TransLink's GTFS-RT (General Transit Feed Specification - Realtime) API to fetch live ferry data. Key endpoints:

- **TripUpdates**: Real-time departure information
- **VehiclePositions**: Live ferry locations  
- **ServiceAlerts**: Service disruptions
- **Static GTFS**: Complete timetable data in ZIP format

## Development Workflow

### Branch Strategy

- **`main`** - Production branch → Deploys to https://ferry.lifemap.au and https://www.brisbaneferry.com
- **`develop`** - Pre-production branch → Deploys to https://brisbane-ferry-tracker.vercel.app

### Making Changes

1. All new development happens on `develop` branch
2. Test changes on pre-production (vercel.app)
3. When ready for production:
   ```bash
   git checkout main
   git merge develop
   git push
   ```

## Contributing

1. Fork the repository
2. Create a feature branch from `develop` (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request to `develop` branch

## License

This project is open source and available under the MIT License.

## Acknowledgments

- Data provided by [TransLink Queensland](https://translink.com.au/)
- Built with the React + Vite + Tailwind CSS stack