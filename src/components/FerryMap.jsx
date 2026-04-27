import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import clsx from 'clsx';
import { Capacitor } from '@capacitor/core';
import 'leaflet/dist/leaflet.css';
import { STOPS, SERVICE_TYPES, MAX_FERRY_DISTANCE_METERS, DEBUG_CONFIG } from '../utils/constants';
import { FERRY_STOPS } from '../utils/ferryStops';
import { findNearestTerminal } from '../utils/geo';
import { getStopNameSync, preloadStopData } from '../utils/stopNames';
import { getVesselWrap } from '../utils/wrappedVessels';
import useNearestStop from '../hooks/useNearestStop';

// BRI-38: stable list of every known ferry terminal, used once per filter
// pass to reject GTFS-RT vehicles that are nowhere near the river.
const FERRY_TERMINALS = Object.values(FERRY_STOPS);
// BRI-33: pull the wrap catalogue directly so the legend iterates over the same
// source of truth the runtime matcher uses. Adding a new wrap is a JSON edit.
import WRAPPED_VESSELS from '../data/wrappedVessels.json';
import blueyUrl from '../assets/wraps/bluey.svg?url';
import bingoUrl from '../assets/wraps/bingo.svg?url';

// Map iconKey → bundled asset URL. Keep parallel to the map in `utils/wrappedVessels.js`.
const WRAP_LEGEND_ICONS = {
  bluey: blueyUrl,
  bingo: bingoUrl,
};

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
  
  if (!serviceInfo) return '#6B7280'; // Same gray as cross-river for unknown routes
  
  // Map Tailwind colors to hex
  const colorMap = {
    'bg-ferry-orange': '#FF6B6B', // Red for express
    'bg-ferry-aqua': '#4ECDC4',   // Teal for all-stops
    'bg-gray-500': '#6B7280'       // Gray for cross-river
  };
  
  return colorMap[serviceInfo.color] || '#6B7280';
};

// Create custom ferry icon.
// BRI-15: when `wrap` is passed (Bluey/Bingo/...), overlay the wrap icon SVG
// on top of the marker. Unwrapped ferries render unchanged.
// BRI-33: marker colour now always reflects the *route type* — even when wrapped.
// The wrap's brand colour is shown in the inline card chip (DepartureItem) and
// the popup; on the map, colour carries route meaning and the face carries
// vessel identity. Two clean channels beat three overlapping ones.
const createFerryIcon = (routeId, wrap = null) => {
  const color = getServiceColor(routeId);
  const size = wrap ? 34 : 28;

  // Unique id so multiple markers on the same page don't conflict on <defs>
  const filterId = `shadow-${wrap ? 'w' : 'b'}-${Math.random().toString(36).slice(2, 7)}`;

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
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.85; transform: scale(1.08); }
            100% { opacity: 1; transform: scale(1); }
          }
        </style>
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="animation: pulse 2s infinite;">
          <defs>
            <filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
            </filter>
          </defs>
          ${wrap
            ? `<circle cx="${size / 2}" cy="${size / 2}" r="${(size / 2) - 2}" fill="${color}" stroke="white" stroke-width="2.5" filter="url(#${filterId})"/>
               <g transform="translate(5 5) scale(${(size - 10) / 64})">${wrap.iconSvg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '')}</g>`
            : `<circle cx="14" cy="14" r="10" fill="${color}" stroke="white" stroke-width="2" filter="url(#${filterId})"/>`
          }
        </svg>
      </div>
    `,
    className: wrap ? 'ferry-marker ferry-marker-wrapped' : 'ferry-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
};

// Terminal icon
const terminalIcon = L.divIcon({
  html: '<div style="font-size: 20px;">📍</div>',
  className: 'terminal-marker',
  iconSize: [20, 20],
  iconAnchor: [10, 20]
});

// BRI-37: User-location pin. Distinctive blue so it never gets mistaken for a
// ferry marker (those are route-coloured — red/teal/gray). Pulses to draw the
// eye on first drop.
const USER_PIN_ICON = L.divIcon({
  html: `
    <div style="width: 24px; height: 24px; position: relative;">
      <style>
        @keyframes user-pulse {
          0%   { opacity: 0.55; transform: scale(1); }
          70%  { opacity: 0;    transform: scale(2.2); }
          100% { opacity: 0;    transform: scale(2.2); }
        }
      </style>
      <div style="position: absolute; inset: 0; border-radius: 50%; background: #2563eb; animation: user-pulse 2s infinite;"></div>
      <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 14px; height: 14px; border-radius: 50%; background: #2563eb; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.35);"></div>
    </div>
  `,
  className: 'user-location-marker',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// BRI-37: Nearest-terminal highlight. Orange pulsing ring + solid dot. Matches
// the app's ferry-orange accent so users connect it visually with the brand.
const NEAREST_TERMINAL_ICON = L.divIcon({
  html: `
    <div style="width: 44px; height: 44px; position: relative;">
      <style>
        @keyframes nearest-pulse {
          0%, 100% { transform: scale(0.85); opacity: 0.9; }
          50%      { transform: scale(1.15); opacity: 0.4; }
        }
      </style>
      <div style="position: absolute; inset: 0; border-radius: 50%; border: 3px solid #FF6B35; box-sizing: border-box; animation: nearest-pulse 1.8s ease-in-out infinite; transform-origin: center;"></div>
      <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; border-radius: 50%; background: #FF6B35; border: 2px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
    </div>
  `,
  className: 'nearest-terminal-marker',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

function formatDistance(meters) {
  if (meters == null) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const cleanStopName = (name) => (name ? name.replace(' ferry terminal', '') : '');

// BRI-37: Small react-leaflet child that fits the map bounds to include the
// user location + nearest terminal whenever a fresh locate action completes.
// Guarded by a monotonic `trigger` prop so spurious re-renders don't re-pan.
function MapFitToLocation({ userLocation, nearestStop, trigger }) {
  const map = useMap();
  const lastTrigger = useRef(null);

  useEffect(() => {
    if (!userLocation || !nearestStop) return;
    if (trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;

    const bounds = L.latLngBounds([
      [userLocation.lat, userLocation.lng],
      [nearestStop.lat, nearestStop.lng],
    ]);
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16, animate: true });
  }, [userLocation, nearestStop, trigger, map]);

  return null;
}

// BRI-37: Nearest-terminal marker that auto-opens its popup when the stop
// changes (so the user immediately sees name + distance + "Get directions"
// without an extra tap).
function NearestTerminalMarker({ stop, distanceMeters, onDismiss, onDirections }) {
  const markerRef = useRef(null);

  useEffect(() => {
    // react-leaflet 5: the marker ref resolves to the Leaflet marker instance.
    const m = markerRef.current;
    if (m && typeof m.openPopup === 'function') m.openPopup();
  }, [stop.id]);

  return (
    <Marker
      ref={markerRef}
      position={[stop.lat, stop.lng]}
      icon={NEAREST_TERMINAL_ICON}
      zIndexOffset={400}
    >
      <Popup autoClose={false} closeOnClick={false} closeButton={false}>
        <div className="text-sm min-w-[10rem]">
          <p className="font-bold text-charcoal">{cleanStopName(stop.name)}</p>
          <p className="text-gray-600 mt-0.5">{formatDistance(distanceMeters)} from you</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onDirections}
              className="px-2.5 py-1 text-xs font-semibold bg-ferry-orange text-white rounded hover:bg-ferry-orange-dark transition-colors"
            >
              Get directions
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-2.5 py-1 text-xs text-gray-600 hover:text-gray-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

// BRI-37: Absolute-positioned React overlay on the map wrapper — locate-me
// button + status banners. Not a Leaflet L.Control because driving styling
// from React state is simpler this way.
function LocateMeOverlay({ nearest }) {
  const active =
    nearest.status === 'granted' ||
    nearest.status === 'out_of_range' ||
    nearest.status === 'denied' ||
    nearest.status === 'error';
  const requesting = nearest.status === 'requesting';

  return (
    <>
      <button
        type="button"
        onClick={active ? nearest.reset : nearest.request}
        disabled={requesting}
        aria-label={active ? 'Hide my location' : 'Show my location'}
        title={active ? 'Hide my location' : 'Show my location'}
        className={clsx(
          'absolute top-3 right-3 z-[1000] w-11 h-11 flex items-center justify-center rounded-lg shadow-md border-2 transition-all',
          active
            ? 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700'
            : 'bg-white border-gray-200 text-gray-700 hover:border-ferry-orange hover:text-ferry-orange',
          requesting && 'opacity-60 cursor-not-allowed',
        )}
      >
        {requesting ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>

      {nearest.status === 'denied' && (
        <div className="absolute top-3 left-3 right-16 z-[1000] bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-3 text-sm shadow-md flex items-start gap-2">
          <span className="flex-1">Location access is off. Enable it in Settings → Brisbane Ferry to use this.</span>
          <button type="button" onClick={nearest.reset} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900 text-lg leading-none">
            ×
          </button>
        </div>
      )}

      {nearest.status === 'error' && (
        <div className="absolute top-3 left-3 right-16 z-[1000] bg-red-50 border border-red-300 text-red-900 rounded-lg p-3 text-sm shadow-md flex items-start gap-2">
          <span className="flex-1">Couldn&apos;t get your location. Try again.</span>
          <button type="button" onClick={nearest.reset} aria-label="Dismiss" className="text-red-700 hover:text-red-900 text-lg leading-none">
            ×
          </button>
        </div>
      )}

      {nearest.status === 'out_of_range' && nearest.nearestStop && (
        <div className="absolute top-3 left-3 right-16 z-[1000] bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-3 text-sm shadow-md flex items-start gap-2">
          <span className="flex-1">
            You&apos;re {(nearest.distanceMeters / 1000).toFixed(1)} km from the nearest terminal
            ({cleanStopName(nearest.nearestStop.name)}). Too far to show on this map.
          </span>
          <button type="button" onClick={nearest.reset} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900 text-lg leading-none">
            ×
          </button>
        </div>
      )}
    </>
  );
}

function FerryMap({ vehiclePositions, tripUpdates, departures, onHide }) {
  // Preload stop data on component mount
  useEffect(() => {
    preloadStopData();
  }, []);

  // BRI-37: "Locate me" on the map. Hook is shared with the StopSelectorModal
  // button (BRI-26 Phase 1). Monotonic trigger bumps on each successful locate,
  // used by MapFitToLocation to re-frame the map exactly once per action.
  const nearest = useNearestStop();
  const [fitTrigger, setFitTrigger] = useState(0);
  useEffect(() => {
    if (nearest.status === 'granted' && nearest.userLocation && nearest.nearestStop) {
      setFitTrigger((t) => t + 1);
    }
  }, [
    nearest.status,
    nearest.userLocation?.lat,
    nearest.userLocation?.lng,
    nearest.nearestStop?.id,
  ]);

  // Hand off directions to the native Maps app. On Capacitor iOS the maps://
  // scheme always resolves to Apple Maps; window.open with target '_system'
  // escapes the WebView and opens in the OS handler.
  const openDirections = (stop) => {
    if (!stop) return;
    const name = cleanStopName(stop.name) || 'Ferry Terminal';
    const url = `maps://?daddr=${stop.lat},${stop.lng}&q=${encodeURIComponent(name)}`;
    window.open(url, '_system');
  };

  // Helper to check if a stop ID is a ferry stop
  const isFerryStop = (stopId) => {
    return stopId && stopId.toString().startsWith('3');
  };
  // Process vehicle positions to get ferry locations
  const ferryLocations = vehiclePositions
    .filter(vp => {
      const vehicle = vp.vehicle;
      if (!vehicle || !vehicle.position || !vehicle.trip) return false;

      // Show all ferries with valid ferry route IDs (starting with F)
      // Filter out Queensland Rail trips (containing "QR")
      const routeId = vehicle.trip.routeId;
      const tripId = vehicle.trip.tripId;
      if (!(routeId && routeId.startsWith('F') && !tripId?.includes('QR'))) {
        return false;
      }

      // BRI-38: geographic sanity. Real ferries can't leave the river — anything
      // farther than MAX_FERRY_DISTANCE_METERS from the nearest known terminal
      // is feed noise. Caught a non-ferry vehicle (TSN6, UNPLANNED-93822063)
      // rendering over Stafford Road on 2026-04-20 despite passing both guards
      // above (synthetic F-prefixed routeId in the GTFS-RT feed).
      const nearest = findNearestTerminal(
        vehicle.position.latitude,
        vehicle.position.longitude,
        FERRY_TERMINALS
      );
      if (nearest && nearest.distanceMeters <= MAX_FERRY_DISTANCE_METERS) {
        return true;
      }

      if (DEBUG_CONFIG.enableLogging) {
        console.log('[BRI-38] filtered', {
          vehicleId: vehicle.vehicle?.id,
          tripId,
          routeId,
          position: vehicle.position,
          nearestKm: nearest ? (nearest.distanceMeters / 1000).toFixed(2) : null,
        });
      }
      return false;
    })
    .map(vp => {
      const vehicle = vp.vehicle;
      const position = vehicle.position;
      const trip = vehicle.trip;
      
      // Find the trip update to get stop sequence
      const tripUpdate = tripUpdates.find(tu => 
        tu.tripUpdate?.trip?.tripId === trip.tripId
      );
      
      const stopTimeUpdates = tripUpdate?.tripUpdate?.stopTimeUpdate || [];
      const currentStopSequence = vehicle.currentStopSequence || 0;
      
      // Find current/last stop and next stop
      let currentStop = null;
      let nextStop = null;
      
      if (stopTimeUpdates.length > 0) {
        // Find stops based on stop sequence
        const currentStopUpdate = stopTimeUpdates.find(stu => 
          parseInt(stu.stopSequence) === currentStopSequence
        );
        const nextStopUpdate = stopTimeUpdates.find(stu => 
          parseInt(stu.stopSequence) === currentStopSequence + 1
        );
        
        currentStop = currentStopUpdate?.stopId;
        nextStop = nextStopUpdate?.stopId;
        
        // Filter to only ferry stops (IDs starting with 3)
        currentStop = isFerryStop(currentStop) ? currentStop : null;
        nextStop = isFerryStop(nextStop) ? nextStop : null;
        
        // If we don't have current stop but have sequence, it might be between stops
        if (!currentStop && currentStopSequence > 0) {
          // Find the last stop (one before current sequence)
          const lastStopUpdate = stopTimeUpdates.find(stu => 
            parseInt(stu.stopSequence) === currentStopSequence - 1
          );
          currentStop = lastStopUpdate?.stopId;
          // Filter to only ferry stops
          currentStop = isFerryStop(currentStop) ? currentStop : null;
        }
      }
      
      return {
        id: vehicle.vehicle?.id || trip.tripId,
        lat: position.latitude,
        lng: position.longitude,
        bearing: position.bearing,
        tripId: trip.tripId,
        routeId: trip.routeId,
        routePrefix: trip.routeId.split('-')[0],
        currentStopSequence: currentStopSequence,
        currentStatus: vehicle.currentStatus,
        currentStop: currentStop,
        nextStop: nextStop,
        vehicleName: vehicle.vehicle?.label || vehicle.vehicle?.id?.split('_').pop() || 'Unknown',
        // BRI-15: resolved wrap metadata (null for unwrapped ferries).
        wrap: getVesselWrap(vehicle.vehicle?.id)
      };
    });

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
      
      <div className="relative rounded-lg overflow-hidden border border-gray-200" style={{ height: '400px' }}>
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

          {/* BRI-37: user location pin + nearest-terminal highlight, iOS-only
              (hook is inert on web — never transitions to 'granted'). */}
          {nearest.status === 'granted' && nearest.userLocation && (
            <Marker
              position={[nearest.userLocation.lat, nearest.userLocation.lng]}
              icon={USER_PIN_ICON}
              zIndexOffset={500}
              keyboard={false}
              interactive={false}
            />
          )}
          {nearest.status === 'granted' && nearest.nearestStop && (
            <NearestTerminalMarker
              stop={nearest.nearestStop}
              distanceMeters={nearest.distanceMeters}
              onDirections={() => openDirections(nearest.nearestStop)}
              onDismiss={nearest.reset}
            />
          )}
          <MapFitToLocation
            userLocation={nearest.userLocation}
            nearestStop={nearest.status === 'granted' ? nearest.nearestStop : null}
            trigger={fitTrigger}
          />

          {/* Ferry markers */}
          {ferryLocations.map(ferry => (
            <Marker
              key={ferry.id}
              position={[ferry.lat, ferry.lng]}
              icon={createFerryIcon(ferry.routeId, ferry.wrap)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold">
                    {SERVICE_TYPES[ferry.routePrefix]?.name || 'Ferry'}
                    {ferry.wrap && (
                      <span
                        className="ml-2 inline-block px-2 py-0.5 rounded-full text-white text-xs align-middle"
                        style={{ backgroundColor: ferry.wrap.color }}
                      >
                        {ferry.wrap.wrap}
                      </span>
                    )}
                  </p>
                  <p>Vehicle: {ferry.vehicleName}</p>
                  <p className="text-xs text-gray-500">Trip: {ferry.tripId}</p>
                  
                  {/* Show current/last stop */}
                  {ferry.currentStop && (
                    <p className="mt-2">
                      {ferry.currentStatus === 1 ? 'At: ' : 'Last: '}
                      <span className="font-medium">{getStopNameSync(ferry.currentStop)}</span>
                    </p>
                  )}
                  
                  {/* Show next stop */}
                  {ferry.nextStop && (
                    <p>
                      Next: <span className="font-medium">{getStopNameSync(ferry.nextStop)}</span>
                    </p>
                  )}
                  
                  {/* If no stop info available */}
                  {!ferry.currentStop && !ferry.nextStop && (
                    <p className="mt-2 text-gray-500">No stop information available</p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* BRI-37: locate-me button + status banners. Gated on native; on web
            there's no platform API so we don't even mount the overlay. */}
        {Capacitor.isNativePlatform() && <LocateMeOverlay nearest={nearest} />}
      </div>

      <div className="mt-3 text-sm text-gray-600">
        {/* Service-type row — dynamic, shows only currently-visible route types. */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Service</span>
          {(() => {
            const visibleServiceTypes = [...new Set(ferryLocations.map(f => f.routePrefix))]
              .map(prefix => ({ prefix, info: SERVICE_TYPES[prefix] }))
              .filter(item => item.info);

            // Add unknown type if there are ferries with unknown routes AND F21 is not already visible
            const hasUnknownTypes = ferryLocations.some(f => !SERVICE_TYPES[f.routePrefix]);
            const hasF21Visible = visibleServiceTypes.some(item => item.prefix === 'F21');

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
                {hasUnknownTypes && !hasF21Visible && (
                  <div className="flex items-center">
                    <svg width="20" height="20" viewBox="0 0 20 20" className="mr-2">
                      <circle cx="10" cy="10" r="7" fill="#6B7280" stroke="white" strokeWidth="1.5"/>
                    </svg>
                    <span>⛴️ Cross-river ferries</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* BRI-33: wrapped-vessels row — always shown (educational), face-icon-only
            chips so we don't imply the marker itself will be brand-coloured. */}
        <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Special</span>
          {WRAPPED_VESSELS.map((w) => {
            const iconUrl = WRAP_LEGEND_ICONS[w.iconKey];
            return (
              <div key={w.wrap} className="flex items-center" title={w.description}>
                {iconUrl && (
                  <img src={iconUrl} alt="" aria-hidden="true" className="w-6 h-6 mr-2" />
                )}
                <span>{w.wrap}</span>
              </div>
            );
          })}
        </div>

        {ferryLocations.length === 0 && (
          <p className="mt-2 text-center text-gray-500">No active ferries visible</p>
        )}
      </div>
    </div>
  );
}

export default FerryMap;