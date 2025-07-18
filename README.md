# Brisbane Ferry Tracker

A real-time ferry departure tracker for Brisbane's Bulimba ⟷ Riverside ferry route, built with React, Vite, and Tailwind CSS.

## Features

- 🚤 Live departure times for Express (F11) and All-stops (F1) CityCat services
- 🎯 Accurate filtering to show only ferries traveling between Bulimba and Riverside
- ⏱️ Real-time countdown timers for next departures
- 📅 Shows scheduled times when real-time data unavailable (early mornings)
- 🔄 Auto-refresh every 5 minutes
- 🎛️ Interactive filter for Express-only view
- 📱 Fully responsive design
- ⚡ Progressive loading - see live ferries instantly while schedule loads
- 📊 "More..." button to expand from 5 to 13 departures per direction
- 🕐 Shows scheduled time in brackets for live departures
- 📢 Dynamic status messages based on available data

## Tech Stack

- **Frontend**: React 19 + Vite
- **Styling**: Tailwind CSS v3
- **Data Source**: TransLink GTFS-RT (Real-time Transit Feed)
- **Deployment**: Vercel
- **Key Libraries**: 
  - `gtfs-realtime-bindings` - For parsing GTFS protobuf data
  - `date-fns` - For time calculations
  - `clsx` - For conditional styling

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
│   ├── Navigation.jsx   # App header
│   ├── StatusBar.jsx    # Update status and refresh
│   ├── DepartureBoard.jsx # Direction-specific departures
│   ├── DepartureItem.jsx  # Individual ferry display
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
   - Only ~50KB instead of 30MB GTFS file
   - Filtered to show only Bulimba-Riverside services
   
2. **Real-time GTFS-RT**: Shows live ferry positions and delays (only available for actively running services)

3. **Static GTFS Schedule** (Fallback): Full timetable data processed client-side if GitHub data unavailable

### Ferry Filtering
The app intelligently filters ferry services to show only those traveling between Bulimba and Riverside:

- ✅ Shows: Ferries departing Bulimba that will arrive at Riverside
- ✅ Shows: Ferries departing Riverside that will arrive at Bulimba  
- ❌ Excludes: Ferries that stop at one terminal but don't continue to the other
- ❌ Excludes: Ferries traveling in the opposite direction (e.g., already been to destination)

Key features:
- **TripId-based tracking**: Each ferry journey is uniquely identified
- **Stop sequence ordering**: Ensures correct direction determination
- **Smart merging**: Matches real-time updates with scheduled times using tripId

## API Integration

The app uses TransLink's GTFS-RT (General Transit Feed Specification - Realtime) API to fetch live ferry data. Key endpoints:

- **TripUpdates**: Real-time departure information
- **VehiclePositions**: Live ferry locations  
- **ServiceAlerts**: Service disruptions
- **Static GTFS**: Complete timetable data in ZIP format

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the MIT License.

## Acknowledgments

- Data provided by [TransLink Queensland](https://translink.com.au/)
- Built with the React + Vite + Tailwind CSS stack