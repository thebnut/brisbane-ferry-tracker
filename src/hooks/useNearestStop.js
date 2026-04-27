import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { FERRY_STOPS } from '../utils/ferryStops';
import { haversineMeters, findNearestTerminal } from '../utils/geo';
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
      const near = findNearestTerminal(user.lat, user.lng, terminals);
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
export const __testing = { haversineMeters, findNearest: findNearestTerminal, MAX_DISTANCE_METERS };
