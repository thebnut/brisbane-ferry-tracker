import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STOPS, SERVICE_TYPES, getOccupancyInfo } from '../utils/constants';
import { format, isTomorrow, isAfter, startOfDay, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

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
  
  if (!serviceInfo) return '#9CA3AF'; // Light gray for unknown routes
  
  // Map Tailwind colors to hex
  const colorMap = {
    'bg-ferry-orange': '#FF6B6B', // Red for express
    'bg-ferry-aqua': '#4ECDC4',   // Teal for all-stops
    'bg-gray-500': '#6B7280'       // Gray for cross-river
  };
  
  return colorMap[serviceInfo.color] || '#9CA3AF';
};

// Create custom ferry icon
const createFerryIcon = (routeId) => {
  const color = getServiceColor(routeId);
  
  return L.divIcon({
    html: `
      <div style="
        width: 28px;
        height: 28px;
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
        <svg width="28" height="28" viewBox="0 0 28 28" style="animation: pulse 2s infinite;">
          <defs>
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
            </filter>
          </defs>
          <circle cx="14" cy="14" r="10" fill="${color}" stroke="white" stroke-width="2" filter="url(#shadow)"/>
        </svg>
      </div>
    `,
    className: 'ferry-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
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
  // Process vehicle positions to get ferry locations
  const ferryLocations = vehiclePositions
    .filter(vp => {
      const vehicle = vp.vehicle;
      if (!vehicle || !vehicle.position || !vehicle.trip) return false;
      
      // Show all ferries with valid route IDs
      const routeId = vehicle.trip.routeId;
      return routeId; // Show all ferries
    })
    .map(vp => {
      const vehicle = vp.vehicle;
      const position = vehicle.position;
      const trip = vehicle.trip;
      
      // Find matching departure to get direction
      const matchingDeparture = [...departures.outbound, ...departures.inbound]
        .find(d => d.tripId === trip.tripId);
      
      // Determine if ferry is between our terminals
      const relevantStops = [STOPS.bulimba, STOPS.riverside];
      const isBetweenTerminals = matchingDeparture !== undefined;
      
      return {
        id: vehicle.vehicle?.id || trip.tripId,
        lat: position.latitude,
        lng: position.longitude,
        bearing: position.bearing,
        speed: position.speed,
        tripId: trip.tripId,
        routeId: trip.routeId,
        routePrefix: trip.routeId.split('-')[0],
        direction: matchingDeparture?.direction || 'unknown',
        currentStopSequence: vehicle.currentStopSequence,
        currentStatus: vehicle.currentStatus,
        occupancy: vehicle.occupancyStatus,
        nextStop: matchingDeparture?.stopId,
        departureTime: matchingDeparture?.departureTime,
        isBetweenTerminals
      };
    })
    .filter(ferry => ferry.isBetweenTerminals); // Only show ferries going between our terminals

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
              icon={createFerryIcon(ferry.routeId)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold">
                    {SERVICE_TYPES[ferry.routePrefix]?.name || 'Unknown'} Ferry
                  </p>
                  <p>Route: {ferry.routeId}</p>
                  <p>Direction: {ferry.direction === 'outbound' ? 'To Riverside' : 'To Bulimba'}</p>
                  {ferry.speed && <p>Speed: {Math.round(ferry.speed * 3.6)} km/h</p>}
                  {ferry.occupancy !== null && ferry.occupancy !== undefined && (() => {
                    const occupancyInfo = getOccupancyInfo(ferry.occupancy);
                    return occupancyInfo ? (
                      <p>Occupancy: {occupancyInfo.icon} {occupancyInfo.text}</p>
                    ) : null;
                  })()}
                  {ferry.departureTime && (() => {
                    const departureTimeZoned = toZonedTime(ferry.departureTime, 'Australia/Brisbane');
                    const currentTimeZoned = toZonedTime(new Date(), 'Australia/Brisbane');
                    const tomorrowStart = startOfDay(addDays(currentTimeZoned, 1));
                    const isNotToday = isAfter(departureTimeZoned, tomorrowStart) || isTomorrow(departureTimeZoned);
                    
                    return (
                      <p>
                        Next departure: {format(departureTimeZoned, 'h:mm a')}
                        {isNotToday && (
                          <span className="text-ferry-orange"> ({format(departureTimeZoned, 'dd/MM')})</span>
                        )}
                      </p>
                    );
                  })()}
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
            
            // Add unknown type if there are ferries with unknown routes
            const hasUnknownTypes = ferryLocations.some(f => !SERVICE_TYPES[f.routePrefix]);
            
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
                {hasUnknownTypes && (
                  <div className="flex items-center">
                    <svg width="20" height="20" viewBox="0 0 20 20" className="mr-2">
                      <circle cx="10" cy="10" r="7" fill="#9CA3AF" stroke="white" strokeWidth="1.5"/>
                    </svg>
                    <span>🚢 Other ferries</span>
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