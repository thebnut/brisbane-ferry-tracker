import React from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STOPS } from '../utils/constants';
import { getVesselWrap } from '../utils/wrappedVessels';

// Terminal locations
const TERMINAL_LOCATIONS = {
  bulimba: { lat: -27.4447, lng: 153.0576, name: 'Bulimba Ferry Terminal' },
  riverside: { lat: -27.4747, lng: 153.0177, name: 'Eagle Street Pier (Riverside)' }
};

// Create custom ferry icon.
// BRI-15: wrap-aware — overlays the stylized dog icon when the vessel is a
// specially liveried CityCat (Bluey/Bingo).
const createFerryIcon = (isExpress, wrap = null) => {
  const baseColor = isExpress ? '#FF6B6B' : '#4ECDC4';
  const color = wrap?.color || baseColor;
  const size = wrap ? 44 : 36;
  const filterId = `shadow-detail-${wrap ? 'w' : 'b'}-${Math.random().toString(36).slice(2, 7)}`;

  return L.divIcon({
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <style>
          @keyframes pulse-detail {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.85; transform: scale(1.08); }
            100% { opacity: 1; transform: scale(1); }
          }
        </style>
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="animation: pulse-detail 2s infinite;">
          <defs>
            <filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
            </filter>
          </defs>
          ${wrap
            ? `<circle cx="${size / 2}" cy="${size / 2}" r="${(size / 2) - 2}" fill="${color}" stroke="white" stroke-width="2.5" filter="url(#${filterId})"/>
               <g transform="translate(6 6) scale(${(size - 12) / 64})">${wrap.iconSvg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '')}</g>`
            : `<circle cx="18" cy="18" r="14" fill="${color}" stroke="white" stroke-width="2.5" filter="url(#${filterId})"/>`
          }
        </svg>
      </div>
    `,
    className: wrap ? 'ferry-marker-detail ferry-marker-detail-wrapped' : 'ferry-marker-detail',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
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
  // BRI-15: wrap lookup so the mini-map marker matches the main map + list.
  const wrap = getVesselWrap(vehiclePosition?.vehicle?.vehicle?.id || departure.vehicleId);
  
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
          icon={createFerryIcon(isExpress, wrap)}
        />
      )}
    </MapContainer>
  );
}

export default FerryDetailMap;