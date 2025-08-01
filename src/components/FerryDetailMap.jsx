import React from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STOPS } from '../utils/constants';

// Terminal locations
const TERMINAL_LOCATIONS = {
  bulimba: { lat: -27.4447, lng: 153.0576, name: 'Bulimba Ferry Terminal' },
  riverside: { lat: -27.4747, lng: 153.0177, name: 'Eagle Street Pier (Riverside)' }
};

// Create custom ferry icon
const createFerryIcon = (isExpress) => {
  const color = isExpress ? '#FF6B6B' : '#4ECDC4';
  
  return L.divIcon({
    html: `
      <div style="
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <style>
          @keyframes pulse-detail {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
        </style>
        <svg width="36" height="36" viewBox="0 0 36 36" style="animation: pulse-detail 2s infinite;">
          <defs>
            <filter id="shadow-detail" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
            </filter>
          </defs>
          <circle cx="18" cy="18" r="14" fill="${color}" stroke="white" stroke-width="2.5" filter="url(#shadow-detail)"/>
        </svg>
      </div>
    `,
    className: 'ferry-marker-detail',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
};

// Terminal marker
const createTerminalIcon = (isActive) => {
  return L.divIcon({
    html: `
      <div style="
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="${isActive ? '#3B82F6' : '#9CA3AF'}" stroke="white" stroke-width="2"/>
          <circle cx="12" cy="12" r="4" fill="white"/>
        </svg>
      </div>
    `,
    className: 'terminal-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

function FerryDetailMap({ departure, vehiclePosition, hasLiveData }) {
  const position = vehiclePosition?.vehicle?.position;
  const isExpress = departure.routeId.startsWith('F11');
  
  // Determine map center and zoom
  let mapCenter, zoom;
  if (hasLiveData && position) {
    mapCenter = [position.latitude, position.longitude];
    zoom = 15;
  } else {
    // Center between terminals
    mapCenter = [-27.4597, 153.0376];
    zoom = 14;
  }
  
  
  // Determine which terminals to highlight
  const originTerminal = departure.direction === 'outbound' ? 'bulimba' : 'riverside';
  const destinationTerminal = departure.direction === 'outbound' ? 'riverside' : 'bulimba';

  return (
    <MapContainer
      center={mapCenter}
      zoom={zoom}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
      />
      
      
      {/* Terminal markers */}
      <Marker 
        position={[TERMINAL_LOCATIONS[originTerminal].lat, TERMINAL_LOCATIONS[originTerminal].lng]} 
        icon={createTerminalIcon(true)}
      />
      <Marker 
        position={[TERMINAL_LOCATIONS[destinationTerminal].lat, TERMINAL_LOCATIONS[destinationTerminal].lng]} 
        icon={createTerminalIcon(false)}
      />
      
      {/* Ferry marker if live position available */}
      {hasLiveData && position && (
        <Marker
          position={[position.latitude, position.longitude]}
          icon={createFerryIcon(isExpress)}
        />
      )}
    </MapContainer>
  );
}

export default FerryDetailMap;