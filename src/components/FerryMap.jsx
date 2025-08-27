import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STOPS, SERVICE_TYPES } from '../utils/constants';
import { getStopNameSync, preloadStopData } from '../utils/stopNames';
import { getVesselTheme } from '../utils/vesselThemes';

// Fix Leaflet default icon issue with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'
});

// Terminal locations
const TERMINAL_LOCATIONS = {
  bulimba: { lat: -27.4447, lng: 153.0576, name: 'Bulimba Ferry Terminal' },
  riverside: { lat: -27.4747, lng: 153.0177, name: 'Eagle Street Pier (Riverside)' }
};

// Helper function to get color from SERVICE_TYPES
const getServiceColor = (routeId) => {
  const routePrefix = routeId.split('-')[0];
  const serviceInfo = SERVICE_TYPES[routePrefix];
  
  if (!serviceInfo) return '#6B7280'; // Same gray as cross-river for unknown routes
  
  // Map Tailwind colors to hex
  const colorMap = {
    'bg-ferry-orange': '#FF6B6B', // Red for express
    'bg-ferry-aqua': '#4ECDC4',   // Teal for all-stops
    'bg-gray-500': '#6B7280'       // Gray for cross-river
  };
  
  return colorMap[serviceInfo.color] || '#6B7280';
};

// Create custom ferry icon with optional theme
const createFerryIcon = (routeId, vesselName = null) => {
  const vesselTheme = vesselName ? getVesselTheme(vesselName) : null;
  const color = vesselTheme ? vesselTheme.mapColor : getServiceColor(routeId);
  const emoji = vesselTheme ? vesselTheme.dogEmoji : null;
  
  return L.divIcon({
    html: `
      <div style="
        width: ${vesselTheme ? '36px' : '28px'};
        height: ${vesselTheme ? '36px' : '28px'};
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <style>
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
        </style>
        ${vesselTheme ? `
          <div style="position: relative;">
            <svg width="36" height="36" viewBox="0 0 36 36" style="animation: pulse 2s infinite;">
              <defs>
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
                </filter>
              </defs>
              <circle cx="18" cy="18" r="14" fill="${color}" stroke="white" stroke-width="3" filter="url(#shadow)"/>
            </svg>
            <div style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              font-size: 16px;
              line-height: 1;
            ">${emoji}</div>
          </div>
        ` : `
          <svg width="28" height="28" viewBox="0 0 28 28" style="animation: pulse 2s infinite;">
            <defs>
              <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
              </filter>
            </defs>
            <circle cx="14" cy="14" r="10" fill="${color}" stroke="white" stroke-width="2" filter="url(#shadow)"/>
          </svg>
        `}
      </div>
    `,
    className: 'ferry-marker',
    iconSize: vesselTheme ? [36, 36] : [28, 28],
    iconAnchor: vesselTheme ? [18, 18] : [14, 14]
  });
};

// Terminal icon
const terminalIcon = L.divIcon({
  html: '<div style="font-size: 20px;">📍</div>',
  className: 'terminal-marker',
  iconSize: [20, 20],
  iconAnchor: [10, 20]
});

function FerryMap({ vehiclePositions, tripUpdates, departures, onHide }) {
  // Preload stop data on component mount
  useEffect(() => {
    preloadStopData();
  }, []);
  
  // Helper to check if a stop ID is a ferry stop
  const isFerryStop = (stopId) => {
    return stopId && stopId.toString().startsWith('3');
  };
  // Process vehicle positions to get ferry locations
  const ferryLocations = vehiclePositions
    .filter(vp => {
      const vehicle = vp.vehicle;
      if (!vehicle || !vehicle.position || !vehicle.trip) return false;
      
      // Show all ferries with valid ferry route IDs (starting with F)
      // Filter out Queensland Rail trips (containing "QR")
      const routeId = vehicle.trip.routeId;
      const tripId = vehicle.trip.tripId;
      return routeId && routeId.startsWith('F') && !tripId.includes('QR');
    })
    .map(vp => {
      const vehicle = vp.vehicle;
      const position = vehicle.position;
      const trip = vehicle.trip;
      
      // Find the trip update to get stop sequence
      const tripUpdate = tripUpdates.find(tu => 
        tu.tripUpdate?.trip?.tripId === trip.tripId
      );
      
      const stopTimeUpdates = tripUpdate?.tripUpdate?.stopTimeUpdate || [];
      const currentStopSequence = vehicle.currentStopSequence || 0;
      
      // Find current/last stop and next stop
      let currentStop = null;
      let nextStop = null;
      
      if (stopTimeUpdates.length > 0) {
        // Find stops based on stop sequence
        const currentStopUpdate = stopTimeUpdates.find(stu => 
          parseInt(stu.stopSequence) === currentStopSequence
        );
        const nextStopUpdate = stopTimeUpdates.find(stu => 
          parseInt(stu.stopSequence) === currentStopSequence + 1
        );
        
        currentStop = currentStopUpdate?.stopId;
        nextStop = nextStopUpdate?.stopId;
        
        // Filter to only ferry stops (IDs starting with 3)
        currentStop = isFerryStop(currentStop) ? currentStop : null;
        nextStop = isFerryStop(nextStop) ? nextStop : null;
        
        // If we don't have current stop but have sequence, it might be between stops
        if (!currentStop && currentStopSequence > 0) {
          // Find the last stop (one before current sequence)
          const lastStopUpdate = stopTimeUpdates.find(stu => 
            parseInt(stu.stopSequence) === currentStopSequence - 1
          );
          currentStop = lastStopUpdate?.stopId;
          // Filter to only ferry stops
          currentStop = isFerryStop(currentStop) ? currentStop : null;
        }
      }
      
      return {
        id: vehicle.vehicle?.id || trip.tripId,
        lat: position.latitude,
        lng: position.longitude,
        bearing: position.bearing,
        tripId: trip.tripId,
        routeId: trip.routeId,
        routePrefix: trip.routeId.split('-')[0],
        currentStopSequence: currentStopSequence,
        currentStatus: vehicle.currentStatus,
        currentStop: currentStop,
        nextStop: nextStop,
        vehicleName: vehicle.vehicle?.label || vehicle.vehicle?.id?.split('_').pop() || 'Unknown'
      };
    });

  // Map center (between terminals)
  const mapCenter = [-27.4597, 153.0376];
  

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-charcoal flex items-center">
          <span className="mr-2">🗺️</span>
          Live Ferry Positions
        </h2>
        <button
          onClick={onHide}
          className="text-gray-500 hover:text-gray-700 transition-colors px-3 py-1 rounded-lg hover:bg-gray-100"
        >
          <span className="text-sm font-medium">Hide</span>
        </button>
      </div>
      
      <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: '400px' }}>
        <MapContainer
          center={mapCenter}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          />
          
          {/* Ferry markers */}
          {ferryLocations.map(ferry => (
            <Marker
              key={ferry.id}
              position={[ferry.lat, ferry.lng]}
              icon={createFerryIcon(ferry.routeId, ferry.vehicleName)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold">
                    {SERVICE_TYPES[ferry.routePrefix]?.name || 'Ferry'}
                  </p>
                  <p>Vehicle: {ferry.vehicleName}{(() => {
                    const theme = getVesselTheme(ferry.vehicleName);
                    return theme ? ` ${theme.dogEmoji}` : '';
                  })()}</p>
                  {(() => {
                    const theme = getVesselTheme(ferry.vehicleName);
                    return theme ? (
                      <p className="text-xs font-semibold" style={{ color: theme.color }}>
                        {theme.description}
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-gray-500">Trip: {ferry.tripId}</p>
                  
                  {/* Show current/last stop */}
                  {ferry.currentStop && (
                    <p className="mt-2">
                      {ferry.currentStatus === 1 ? 'At: ' : 'Last: '}
                      <span className="font-medium">{getStopNameSync(ferry.currentStop)}</span>
                    </p>
                  )}
                  
                  {/* Show next stop */}
                  {ferry.nextStop && (
                    <p>
                      Next: <span className="font-medium">{getStopNameSync(ferry.nextStop)}</span>
                    </p>
                  )}
                  
                  {/* If no stop info available */}
                  {!ferry.currentStop && !ferry.nextStop && (
                    <p className="mt-2 text-gray-500">No stop information available</p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      
      <div className="mt-3 text-sm text-gray-600">
        <div className="flex flex-wrap items-center justify-center gap-4">
          {/* Get unique service types from visible ferries */}
          {(() => {
            const visibleServiceTypes = [...new Set(ferryLocations.map(f => f.routePrefix))]
              .map(prefix => ({ prefix, info: SERVICE_TYPES[prefix] }))
              .filter(item => item.info);
            
            // Add unknown type if there are ferries with unknown routes AND F21 is not already visible
            const hasUnknownTypes = ferryLocations.some(f => !SERVICE_TYPES[f.routePrefix]);
            const hasF21Visible = visibleServiceTypes.some(item => item.prefix === 'F21');
            
            return (
              <>
                {visibleServiceTypes.map(({ prefix, info }) => (
                  <div key={prefix} className="flex items-center">
                    <svg width="20" height="20" viewBox="0 0 20 20" className="mr-2">
                      <circle cx="10" cy="10" r="7" fill={getServiceColor(prefix)} stroke="white" strokeWidth="1.5"/>
                    </svg>
                    <span>{info.icon} {info.name}</span>
                  </div>
                ))}
                {hasUnknownTypes && !hasF21Visible && (
                  <div className="flex items-center">
                    <svg width="20" height="20" viewBox="0 0 20 20" className="mr-2">
                      <circle cx="10" cy="10" r="7" fill="#6B7280" stroke="white" strokeWidth="1.5"/>
                    </svg>
                    <span>⛴️ Cross-river ferries</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>
        {ferryLocations.length === 0 && (
          <p className="mt-2 text-center text-gray-500">No active ferries visible</p>
        )}
      </div>
    </div>
  );
}

export default FerryMap;