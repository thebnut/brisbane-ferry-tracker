import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STOPS } from '../utils/constants';
import { format } from 'date-fns';
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
const createFerryIcon = (isExpress, direction) => {
  const rotation = direction === 'outbound' ? 315 : 135; // NW for outbound, SE for inbound
  
  return L.divIcon({
    html: `
      <div style="
        transform: rotate(${rotation}deg);
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <span style="font-size: 24px; filter: drop-shadow(2px 2px 2px rgba(0,0,0,0.5));">
          ${isExpress ? '🚤' : '🚢'}
        </span>
      </div>
    `,
    className: 'ferry-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
};

// Terminal icon
const terminalIcon = L.divIcon({
  html: '<div style="font-size: 20px;">📍</div>',
  className: 'terminal-marker',
  iconSize: [20, 20],
  iconAnchor: [10, 20]
});

function FerryMap({ vehiclePositions, tripUpdates, departures }) {
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
  
  // River path approximation
  const riverPath = [
    [-27.4447, 153.0576], // Bulimba
    [-27.4480, 153.0520],
    [-27.4520, 153.0460],
    [-27.4580, 153.0400],
    [-27.4640, 153.0340],
    [-27.4700, 153.0280],
    [-27.4747, 153.0177]  // Riverside
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <h2 className="text-lg font-bold text-charcoal mb-3 flex items-center">
        <span className="mr-2">🗺️</span>
        Live Ferry Positions
      </h2>
      
      <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: '400px' }}>
        <MapContainer
          center={mapCenter}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* River path */}
          <Polyline 
            positions={riverPath}
            color="#0066CC"
            weight={3}
            opacity={0.5}
            dashArray="10, 10"
          />
          
          {/* Terminal markers */}
          <Marker position={[TERMINAL_LOCATIONS.bulimba.lat, TERMINAL_LOCATIONS.bulimba.lng]} icon={terminalIcon}>
            <Popup>
              <strong>{TERMINAL_LOCATIONS.bulimba.name}</strong>
            </Popup>
          </Marker>
          
          <Marker position={[TERMINAL_LOCATIONS.riverside.lat, TERMINAL_LOCATIONS.riverside.lng]} icon={terminalIcon}>
            <Popup>
              <strong>{TERMINAL_LOCATIONS.riverside.name}</strong>
            </Popup>
          </Marker>
          
          {/* Ferry markers */}
          {ferryLocations.map(ferry => (
            <Marker
              key={ferry.id}
              position={[ferry.lat, ferry.lng]}
              icon={createFerryIcon(ferry.isExpress, ferry.direction)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold">
                    {ferry.isExpress ? 'EXPRESS' : 'All-stops'} Ferry
                  </p>
                  <p>Route: {ferry.routeId}</p>
                  <p>Direction: {ferry.direction === 'outbound' ? 'To Riverside' : 'To Bulimba'}</p>
                  {ferry.speed && <p>Speed: {Math.round(ferry.speed * 3.6)} km/h</p>}
                  {ferry.occupancy && (
                    <p>Occupancy: {
                      ferry.occupancy === 'MANY_SEATS_AVAILABLE' ? '🟢 Many seats' :
                      ferry.occupancy === 'FEW_SEATS_AVAILABLE' ? '🟡 Few seats' :
                      ferry.occupancy === 'STANDING_ROOM_ONLY' ? '🟠 Standing room' :
                      ferry.occupancy === 'CRUSHED_STANDING_ROOM_ONLY' ? '🔴 Very full' :
                      ferry.occupancy === 'FULL' ? '🔴 Full' :
                      ferry.occupancy.replace(/_/g, ' ')
                    }</p>
                  )}
                  {ferry.departureTime && (
                    <p>Next departure: {format(toZonedTime(ferry.departureTime, 'Australia/Brisbane'), 'h:mm a')}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      
      <div className="mt-3 text-sm text-gray-600">
        <p className="flex items-center">
          <span className="mr-2">🚤</span>Express ferries
          <span className="mx-4">🚢</span>All-stops ferries
          <span className="mx-4">📍</span>Terminals
        </p>
        {ferryLocations.length === 0 && (
          <p className="mt-2 text-center text-gray-500">No ferries currently between terminals</p>
        )}
      </div>
    </div>
  );
}

export default FerryMap;