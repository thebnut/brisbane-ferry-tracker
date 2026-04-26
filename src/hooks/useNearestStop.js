import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { FERRY_STOPS } from '../utils/ferryStops';
import staticGtfsService from '../services/staticGtfsService';

// BRI-26: One-shot geolocation + haversine nearest-terminal resolution for iOS.
// Ferries are blocks apart — low-accuracy coarse GPS is plenty and drains
// battery less. The caller gates UI entry points on Capacitor.isNativePlatform()
// so this hook is effectively iOS-only today; on web/other, request() no-ops
// with a dev-mode warning and sets status to 'error'.
//
// Privacy: location is never persisted or transmitted. Everything stays in
// memory for the component lifetime; reset() clears it.

const MAX_DISTANCE_METERS = 5000; // matches docs/nearest_stop_prd.md proximity rule
const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine great-circle distance in metres. Accurate enough for "which ferry
// terminal is closest"; error << terminal spacing within Brisbane.
function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// Prefer the richer GTFS-derived stop list if it's loaded (more terminals and
// any recent additions); fall back to the hardcoded FERRY_STOPS table.
function getAllTerminalsWithCoords() {
  if (staticGtfsService.hasStopsData?.()) {
    const serviceStops = staticGtfsService.getAvailableStops?.() || [];
    const withCoords = serviceStops.filter((s) => s?.lat != null && s?.lng != null);
    if (withCoords.length > 0) return withCoords;
  }

  return Object.entries(FERRY_STOPS).map(([id, s]) => ({
    id,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
  }));
}

function findNearest(userLat, userLng, terminals) {
  let best = null;
  let bestDist = Infinity;
  for (const t of terminals) {
    const d = haversineMeters(userLat, userLng, t.lat, t.lng);
    if (d < bestDist) {
      bestDist = d;
      best = { ...t, distanceMeters: Math.round(d) };
    }
  }
  return best;
}

/**
 * Hook: request the user's current location and return the nearest ferry terminal.
 *
 * @returns {{
 *   status: 'idle' | 'requesting' | 'granted' | 'denied' | 'error' | 'out_of_range',
 *   userLocation: { lat: number, lng: number } | null,
 *   nearestStop: { id: string, name: string, lat: number, lng: number, distanceMeters: number } | null,
 *   distanceMeters: number | null,
 *   request: () => Promise<void>,
 *   reset: () => void,
 * }}
 */
export default function useNearestStop() {
  const [status, setStatus] = useState('idle');
  const [userLocation, setUserLocation] = useState(null);
  const [nearestStop, setNearestStop] = useState(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setUserLocation(null);
    setNearestStop(null);
  }, []);

  const request = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      if (import.meta?.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[useNearestStop] request() called outside native runtime — no-op');
      }
      setStatus('error');
      return;
    }

    setStatus('requesting');
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,
      });

      const user = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setUserLocation(user);

      const terminals = getAllTerminalsWithCoords();
      const near = findNearest(user.lat, user.lng, terminals);
      setNearestStop(near);

      if (!near) {
        setStatus('error');
      } else if (near.distanceMeters > MAX_DISTANCE_METERS) {
        setStatus('out_of_range');
      } else {
        setStatus('granted');
      }
    } catch (err) {
      const message = err?.message || String(err);
      // Capacitor surfaces permission errors with "denied"/"permission" in the
      // message. Everything else (timeout, unavailable, etc.) is a generic error.
      const isDenied = /denied|permission/i.test(message);
      if (import.meta?.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[useNearestStop] request error:', message);
      }
      setStatus(isDenied ? 'denied' : 'error');
    }
  }, []);

  return {
    status,
    userLocation,
    nearestStop,
    distanceMeters: nearestStop?.distanceMeters ?? null,
    request,
    reset,
  };
}

// Exported for testing; not intended for general use.
export const __testing = { haversineMeters, findNearest, MAX_DISTANCE_METERS };
