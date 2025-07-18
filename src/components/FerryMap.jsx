import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STOPS, getOccupancyInfo } from '../utils/constants';
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

// Create custom ferry icon
const createFerryIcon = (isExpress, bearing) => {
  const rotation = bearing || 0; // Use actual bearing from GPS, default to 0 if not available
  const color = isExpress ? '#FF6B6B' : '#4ECDC4'; // Red for express, teal for all-stops
  
  return L.divIcon({
    html: `
      <div style="
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="28" height="28" viewBox="0 0 28 28" style="transform: rotate(${rotation}deg);">
          <defs>
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
            </filter>
          </defs>
          <circle cx="14" cy="14" r="12" fill="${color}" stroke="white" stroke-width="2" filter="url(#shadow)"/>
          <path d="M14 7 L18 17.5 L14 15.5 L10 17.5 Z" fill="white"/>
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
      
      // Only show ferries on our routes
      const routeId = vehicle.trip.routeId;
      return routeId && (routeId.startsWith('F1') || routeId.startsWith('F11'));
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
        isExpress: trip.routeId.startsWith('F11'),
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
              icon={createFerryIcon(ferry.isExpress, ferry.bearing)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold">
                    {ferry.isExpress ? 'EXPRESS' : 'All-stops'} Ferry
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
        <div className="flex items-center justify-center space-x-6">
          <div className="flex items-center">
            <svg width="20" height="20" viewBox="0 0 40 40" className="mr-2">
              <circle cx="20" cy="20" r="18" fill="#FF6B6B" stroke="white" stroke-width="2"/>
              <path d="M20 10 L26 25 L20 22 L14 25 Z" fill="white"/>
            </svg>
            <span>Express ferries</span>
          </div>
          <div className="flex items-center">
            <svg width="20" height="20" viewBox="0 0 40 40" className="mr-2">
              <circle cx="20" cy="20" r="18" fill="#4ECDC4" stroke="white" stroke-width="2"/>
              <path d="M20 10 L26 25 L20 22 L14 25 Z" fill="white"/>
            </svg>
            <span>All-stops ferries</span>
          </div>
        </div>
        {ferryLocations.length === 0 && (
          <p className="mt-2 text-center text-gray-500">No ferries currently between terminals</p>
        )}
      </div>
    </div>
  );
}

export default FerryMap;