import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getStopNameSync, preloadStopData } from '../utils/stopNames';
import { 
  getUserLocation, 
  findNearestStop, 
  formatDistance, 
  isGeolocationAvailable,
  getGeolocationErrorMessage 
} from '../utils/geolocation';

// Component to fit map bounds to show all stops
function FitBounds({ stops, userLocation, nearestStop }) {
  const map = useMap();
  
  useEffect(() => {
    if (userLocation && nearestStop) {
      // If we have user location and nearest stop, fit bounds to show both
      const bounds = [
        [userLocation.lat, userLocation.lng],
        [nearestStop.stop.lat, nearestStop.stop.lng]
      ];
      map.fitBounds(bounds, { padding: [80, 80] });
    } else if (stops.length > 0) {
      const bounds = stops.map(stop => [stop.lat, stop.lng]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [stops, map, userLocation, nearestStop]);
  
  return null;
}

// Component to handle map centering
function MapController({ center, zoom }) {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || 14);
    }
  }, [center, zoom, map]);
  
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
  const [userLocation, setUserLocation] = useState(null);
  const [nearestStop, setNearestStop] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const mapRef = useRef(null);
  
  // Preload stop names on mount
  useEffect(() => {
    preloadStopData();
  }, []);
  
  // Get marker color based on stop state
  const getMarkerColor = (stopId) => {
    if (nearestStop && nearestStop.stop.id === stopId) return '#10b981'; // green for nearest
    if (stopId === selectedOrigin) return '#10b981'; // green
    if (stopId === selectedDestination) return '#ef4444'; // red
    if (selectionMode === 'destination' && !validDestinations.includes(stopId)) return '#9ca3af'; // gray
    return '#FF6B35'; // orange (ferry brand color)
  };
  
  // Get marker size based on state
  const getMarkerRadius = (stopId) => {
    if (nearestStop && nearestStop.stop.id === stopId) return 14; // Largest for nearest
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
      // Clear nearest stop when manually selecting
      setNearestStop(null);
      setUserLocation(null);
    } else if (selectionMode === 'destination') {
      // If clicking the already selected destination, deselect it
      if (stop.id === selectedDestination) {
        onDestinationSelect(null);
      } else {
        onDestinationSelect(stop.id);
      }
      // Clear nearest stop when manually selecting
      setNearestStop(null);
      setUserLocation(null);
    }
  };
  
  // Handle nearest stop button click
  const handleNearestStopClick = async () => {
    setLocationLoading(true);
    setLocationError(null);
    
    try {
      const location = await getUserLocation();
      setUserLocation(location);
      
      // Find nearest stop
      const nearest = findNearestStop(location, stops);
      
      if (nearest) {
        if (nearest.tooFar) {
          setLocationError(`Nearest stop is ${formatDistance(nearest.distance)} away. Ferry stops may be too far from your location.`);
        } else {
          setNearestStop(nearest);
          
          // Auto-select the nearest stop based on current selection mode
          if (selectionMode === 'origin') {
            onOriginSelect(nearest.stop.id);
          } else if (selectionMode === 'destination' && validDestinations.includes(nearest.stop.id)) {
            onDestinationSelect(nearest.stop.id);
          } else if (selectionMode === 'destination') {
            setLocationError('The nearest stop is not available as a destination from your selected origin.');
          }
        }
        
        // Center map on user location
        setMapCenter([location.lat, location.lng]);
      } else {
        setLocationError('No ferry stops found.');
      }
    } catch (error) {
      setLocationError(getGeolocationErrorMessage(error));
      console.error('Geolocation error:', error);
    } finally {
      setLocationLoading(false);
    }
  };
  
  // Default map center (Brisbane ferry network center)
  const defaultMapCenter = [-27.4700, 153.0260];
  
  return (
    <div className="relative">
      {/* Nearest Stop Button */}
      <div className="absolute top-2 right-2 z-10">
        <button
          onClick={handleNearestStopClick}
          disabled={locationLoading || !isGeolocationAvailable()}
          className="bg-white px-3 py-2 rounded-lg shadow-md hover:shadow-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 border border-gray-200"
          title={!isGeolocationAvailable() ? 'Location services not available' : 'Find nearest ferry stop'}
        >
          {locationLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-ferry-orange"></div>
              <span className="text-sm font-medium">Locating...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 text-ferry-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm font-medium">Nearest Stop</span>
            </>
          )}
        </button>
      </div>
      
      {/* Error Message */}
      {locationError && (
        <div className="absolute top-14 right-2 z-10 bg-red-50 border border-red-200 rounded-lg p-3 max-w-xs shadow-lg">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm text-red-700">{locationError}</p>
              <button
                onClick={() => setLocationError(null)}
                className="text-xs text-red-600 hover:text-red-800 mt-1 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Success Message */}
      {nearestStop && !nearestStop.tooFar && (
        <div className="absolute top-14 right-2 z-10 bg-green-50 border border-green-200 rounded-lg p-3 max-w-xs shadow-lg">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm text-green-700">
                Nearest stop: <strong>{getStopNameSync(nearestStop.stop.id)}</strong>
              </p>
              <p className="text-xs text-green-600 mt-1">
                Distance: {formatDistance(nearestStop.distance)}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <div className="rounded-lg overflow-hidden border-2 border-ferry-orange/30" style={{ height: '400px' }}>
      <MapContainer
        center={defaultMapCenter}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        
        <FitBounds stops={stops} userLocation={userLocation} nearestStop={nearestStop} />
        {mapCenter && <MapController center={mapCenter} zoom={14} />}
        
        {/* User Location Marker */}
        {userLocation && (
          <CircleMarker
            center={[userLocation.lat, userLocation.lng]}
            radius={10}
            fillColor="#3B82F6"
            color="#fff"
            weight={3}
            opacity={1}
            fillOpacity={0.8}
            className="pulse-animation"
          >
            <Popup>
              <div className="text-sm font-medium">
                📍 Your Location
                {userLocation.accuracy && (
                  <div className="text-xs text-gray-500 mt-1">
                    Accuracy: ±{Math.round(userLocation.accuracy)}m
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        )}
        
        {/* Ferry Stop Markers */}
        {stops.map(stop => {
          const isClickable = isStopClickable(stop.id);
          const color = getMarkerColor(stop.id);
          const radius = getMarkerRadius(stop.id);
          const isNearest = nearestStop && nearestStop.stop.id === stop.id;
          
          return (
            <CircleMarker
              key={stop.id}
              center={[stop.lat, stop.lng]}
              radius={radius}
              fillColor={color}
              color={isNearest ? '#10b981' : '#fff'}
              weight={isNearest ? 3 : 2}
              opacity={1}
              fillOpacity={isClickable ? 0.8 : 0.4}
              eventHandlers={{
                click: () => handleStopClick(stop),
                mouseover: () => setHoveredStop(stop.id),
                mouseout: () => setHoveredStop(null)
              }}
              className={`${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'} ${isNearest ? 'nearest-stop-animation' : ''}`}
            >
              <Popup>
                <div className="text-sm font-medium">
                  {getStopNameSync(stop.id)}
                  {isNearest && (
                    <div className="text-xs text-green-600 mt-1 font-semibold">
                      ✓ Nearest Stop ({formatDistance(nearestStop.distance)})
                    </div>
                  )}
                  {stop.id === selectedOrigin && !isNearest && (
                    <div className="text-xs text-green-600 mt-1">Origin</div>
                  )}
                  {stop.id === selectedDestination && !isNearest && (
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
    </div>
  );
};

export default StopSelectorMap;