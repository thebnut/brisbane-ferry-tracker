# Brisbane Ferry Tracker

A real-time ferry departure tracker for Brisbane's Bulimba ⟷ Riverside ferry route, built with React, Vite, and Tailwind CSS.

## Features

- 🚤 Live departure times for Express (F11) and All-stops (F1) CityCat services
- 🎯 Accurate filtering to show only ferries traveling between Bulimba and Riverside
- ⏱️ Real-time countdown timers for next departures
- 📅 Shows scheduled times when real-time data unavailable (early mornings)
- 🔄 Auto-refresh every 5 minutes
- 🎛️ Interactive filter for Express-only or All services
- 📱 Fully responsive design
- ⚡ Fast and lightweight single-page application

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

### Deploy to Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

The app includes a serverless function (`/api/gtfs-proxy`) to handle CORS for the TransLink API.

### Manual Deployment

1. Build the project:
```bash
npm run build
```

2. The `dist` folder contains the static files ready for deployment to any static hosting service.

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

### Data Sources
The app combines two data sources for comprehensive coverage:

1. **Real-time GTFS-RT**: Shows live ferry positions and delays (only available for actively running services)
2. **Static GTFS Schedule**: Shows scheduled times from the timetable (used when ferries aren't running yet)

### Ferry Filtering
The app intelligently filters ferry services to show only those traveling between Bulimba and Riverside:

- ✅ Shows: Ferries departing Bulimba that will arrive at Riverside
- ✅ Shows: Ferries departing Riverside that will arrive at Bulimba  
- ❌ Excludes: Ferries that stop at one terminal but don't continue to the other
- ❌ Excludes: Ferries traveling in the opposite direction (e.g., already been to destination)

This ensures accurate, relevant departure information for travelers going between these specific terminals.

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