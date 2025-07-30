import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getStopNameSync, preloadStopData } from '../utils/stopNames';

// Component to fit map bounds to show all stops
function FitBounds({ stops }) {
  const map = useMap();
  
  useEffect(() => {
    if (stops.length > 0) {
      const bounds = stops.map(stop => [stop.lat, stop.lng]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [stops, map]);
  
  return null;
}

const StopSelectorMap = ({ 
  stops, 
  selectedOrigin, 
  selectedDestination, 
  validDestinations,
  onOriginSelect,
  onDestinationSelect,
  selectionMode // 'origin' or 'destination'
}) => {
  const [hoveredStop, setHoveredStop] = useState(null);
  
  // Preload stop names on mount
  useEffect(() => {
    preloadStopData();
  }, []);
  
  // Get marker color based on stop state
  const getMarkerColor = (stopId) => {
    if (stopId === selectedOrigin) return '#10b981'; // green
    if (stopId === selectedDestination) return '#ef4444'; // red
    if (selectionMode === 'destination' && !validDestinations.includes(stopId)) return '#9ca3af'; // gray
    return '#FF6B35'; // orange (ferry brand color)
  };
  
  // Get marker size based on state
  const getMarkerRadius = (stopId) => {
    if (stopId === selectedOrigin || stopId === selectedDestination) return 12;
    if (stopId === hoveredStop) return 10;
    return 8;
  };
  
  // Check if stop is clickable
  const isStopClickable = (stopId) => {
    if (selectionMode === 'origin') return true;
    if (selectionMode === 'destination') {
      return validDestinations.includes(stopId);
    }
    return false;
  };
  
  const handleStopClick = (stop) => {
    if (!isStopClickable(stop.id)) return;
    
    if (selectionMode === 'origin') {
      // If clicking the already selected origin, deselect it
      if (stop.id === selectedOrigin) {
        onOriginSelect(null);
      } else {
        onOriginSelect(stop.id);
      }
    } else if (selectionMode === 'destination') {
      // If clicking the already selected destination, deselect it
      if (stop.id === selectedDestination) {
        onDestinationSelect(null);
      } else {
        onDestinationSelect(stop.id);
      }
    }
  };
  
  // Map center (Brisbane ferry network center)
  const mapCenter = [-27.4700, 153.0260];
  
  return (
    <div className="rounded-lg overflow-hidden border-2 border-ferry-orange/30" style={{ height: '400px' }}>
      <MapContainer
        center={mapCenter}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        
        <FitBounds stops={stops} />
        
        {stops.map(stop => {
          const isClickable = isStopClickable(stop.id);
          const color = getMarkerColor(stop.id);
          const radius = getMarkerRadius(stop.id);
          
          return (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lng]}
              radius={radius}
              fillColor={color}
              color="#fff"
              weight={2}
              opacity={1}
              fillOpacity={isClickable ? 0.8 : 0.4}
              eventHandlers={{
                click: () => handleStopClick(stop),
                mouseover: () => setHoveredStop(stop.id),
                mouseout: () => setHoveredStop(null)
              }}
              className={isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}
            >
              <Popup>
                <div className="text-sm font-medium">
                  {getStopNameSync(stop.id)}
                  {stop.id === selectedOrigin && (
                    <div className="text-xs text-green-600 mt-1">Origin</div>
                  )}
                  {stop.id === selectedDestination && (
                    <div className="text-xs text-red-600 mt-1">Destination</div>
                  )}
                  {selectionMode === 'destination' && !isClickable && (
                    <div className="text-xs text-gray-500 mt-1">No direct connection</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default StopSelectorMap;