/**
 * Geolocation utilities for finding nearest ferry stop
 */

// Geolocation options for accuracy
const DEFAULT_GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000 // Cache for 1 minute
};

/**
 * Get user's current location
 * @param {Object} options - Geolocation options
 * @returns {Promise<{lat: number, lng: number}>}
 * @throws {Error} Permission denied, timeout, or unavailable
 */
export async function getUserLocation(options = {}) {
  const geoOptions = { ...DEFAULT_GEO_OPTIONS, ...options };
  
  return new Promise((resolve, reject) => {
    // Check if geolocation is available
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }
    
    // Check if we're in a secure context (HTTPS)
    if (!window.isSecureContext) {
      reject(new Error('Geolocation requires a secure connection (HTTPS)'));
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        let errorMessage;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please allow location access to find the nearest ferry stop.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable. Please try again.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Please try again.';
            break;
          default:
            errorMessage = 'An unknown error occurred while getting your location.';
        }
        reject(new Error(errorMessage));
      },
      geoOptions
    );
  });
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - First latitude
 * @param {number} lng1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lng2 - Second longitude
 * @returns {number} Distance in meters
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c; // Distance in meters
}

/**
 * Find nearest stop from user location
 * @param {{lat: number, lng: number}} userLocation
 * @param {Array<{id: string, lat: number, lng: number, name: string}>} stops
 * @returns {{stop: Object, distance: number} | null}
 */
export function findNearestStop(userLocation, stops) {
  if (!userLocation || !stops || stops.length === 0) {
    return null;
  }
  
  let nearestStop = null;
  let minDistance = Infinity;
  
  stops.forEach(stop => {
    const distance = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      stop.lat,
      stop.lng
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestStop = stop;
    }
  });
  
  // Check if nearest stop is within reasonable distance (5km)
  if (minDistance > 5000) {
    return {
      stop: nearestStop,
      distance: minDistance,
      tooFar: true
    };
  }
  
  return {
    stop: nearestStop,
    distance: minDistance,
    tooFar: false
  };
}

/**
 * Format distance for display
 * @param {number} meters
 * @returns {string} Formatted distance (e.g., "150m", "1.2km")
 */
export function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Check if geolocation is available in the current context
 * @returns {boolean}
 */
export function isGeolocationAvailable() {
  return !!(navigator.geolocation && window.isSecureContext);
}

/**
 * Parse geolocation error for user-friendly message
 * @param {Error} error
 * @returns {string}
 */
export function getGeolocationErrorMessage(error) {
  if (!error) return 'An unknown error occurred';
  
  // Check for our custom error messages first
  if (error.message && error.message.includes('permission denied')) {
    return error.message;
  }
  if (error.message && error.message.includes('not supported')) {
    return error.message;
  }
  if (error.message && error.message.includes('HTTPS')) {
    return error.message;
  }
  
  // Default fallback
  return error.message || 'Failed to get your location';
}