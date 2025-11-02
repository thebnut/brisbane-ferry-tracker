/**
 * Train Schedule API - Route Query Endpoint
 * VERSION: 7.0 - V7 Enhanced Format Support
 *
 * Query train schedules between two stations using station slugs
 *
 * Usage: /api/schedule/train/route?origin=BOWEN_HILLS&destination=FORTITUDE_VALLEY&hours=24
 *
 * Architecture:
 * - Accepts station slugs directly (e.g., BOWEN_HILLS, FORTITUDE_VALLEY)
 * - Fetches single origin station file (contains ALL routes from that station)
 * - Supports both V6 (verbose) and V7 (minified) data formats
 * - V7 format: 91% smaller, edge-optimized
 * - Perfect for CDN caching (cache by origin station)
 *
 * Runtime: Edge
 * Performance: ~50-150ms response
 */

import { isV7Format, getTripsForDate, minutesToTime } from './v7-decoder.js';

const DEFAULT_HOURS = 24; // Default time window for departures
const CACHE_TTL = 300; // 5 minutes in seconds (for response headers)

// Vercel function configuration
export const config = {
  runtime: 'edge', // Edge runtime for faster cold starts and streaming
  // Force rebuild - Version 5.1 - Edge Runtime
};

/**
 * Main handler for train route queries
 */
export default async function handler(req) {
  const startTime = Date.now();

  try {
    console.log('[DEBUG] Handler started, req.url:', req.url);
    console.log('[DEBUG] req.headers.host:', req.headers?.host);

    // Parse URL - Vercel provides path in req.url, need to construct full URL
    const host = req.headers.host || req.headers.Host || 'localhost';
    const fullUrl = req.url.startsWith('http')
      ? req.url
      : `https://${host}${req.url}`;

    console.log('[DEBUG] Parsed URL:', fullUrl);
    const url = new URL(fullUrl);

    const { searchParams } = url;
    const origin = searchParams.get('origin');
    const destination = searchParams.get('destination');
    const hours = parseInt(searchParams.get('hours') || String(DEFAULT_HOURS), 10);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    // Validation
    if (!origin || !destination) {
      return jsonResponse({
        error: 'Missing required parameters',
        required: ['origin', 'destination'],
        optional: ['hours', 'date'],
        example: '/api/schedule/train/route?origin=BOWEN_HILLS&destination=FORTITUDE_VALLEY&hours=24'
      }, 400);
    }

    // Validate hours range
    if (hours < 1 || hours > 168) { // Max 1 week
      return jsonResponse({
        error: 'Invalid hours parameter',
        message: 'Hours must be between 1 and 168 (1 week)',
        provided: hours
      }, 400);
    }

    // Station slugs are passed directly (e.g., BOWEN_HILLS, FORTITUDE_VALLEY)
    const originSlug = origin.toUpperCase();
    const destSlug = destination.toUpperCase();

    console.log(`[STATION] ${originSlug} → ${destSlug}`);
    console.log(`[STATION] Fetching origin station file: train-station-${originSlug}.json`);

    // Fetch origin station file (contains ALL routes from this station)
    console.log(`[TIMING] Fetching station blob at ${Date.now() - startTime}ms`);
    const stationData = await fetchStationFromBlob(originSlug);
    console.log(`[TIMING] Station blob fetched at ${Date.now() - startTime}ms`);

    if (!stationData) {
      return jsonResponse({
        error: 'Station data not found',
        message: 'Origin station file does not exist',
        origin: originSlug,
        suggestion: 'This station may not have any departures in the schedule'
      }, 404);
    }

    // Extract route to destination from station file
    const routeData = stationData.routes[destSlug];
    console.log(`[TIMING] Extracted destination route at ${Date.now() - startTime}ms`);

    if (!routeData) {
      console.log(`[TIMING] Returning 404 at ${Date.now() - startTime}ms`);
      return jsonResponse({
        error: 'Route not found',
        message: 'No direct route exists between these stations',
        origin: originSlug,
        destination: destSlug,
        suggestion: 'Try different stations or check if a transfer is required'
      }, 404);
    }

    // Handle V7 vs V6 format
    let allDepartures = [];
    const dataVersion = isV7Format(stationData) ? '7.0' : '6.0';
    console.log(`[FORMAT] Detected data version: ${dataVersion}`);

    if (dataVersion === '7.0') {
      // V7 FORMAT: Need to fetch pattern data and expand trips
      console.log(`[TIMING] Fetching pattern data for V7 format at ${Date.now() - startTime}ms`);
      const patternData = await fetchPatternFromBlob(originSlug);

      // Get trips for today only - time window filtering handles cross-day lookups
      const today = new Date().toISOString().split('T')[0];
      const todayTrips = getTripsForDate(stationData, destSlug, today, patternData);

      console.log(`[V7] Got ${todayTrips.length} trips for today`);

      // Convert V7 expanded format to V6 departure format
      allDepartures = todayTrips.map(trip => ({
        tripId: trip.tripId,
        scheduledDeparture: trip.departure.time,
        scheduledArrival: trip.arrival.time,
        headsign: trip.headsign || `${trip.routeName} to ${destSlug}`,
        routeName: trip.routeName,
        routeId: trip.routeId,
        patternId: trip.patternId,
        platform: trip.departure.platform, // ✨ V7.1: Origin platform from decoder
        stopTimes: trip.stopTimes || [], // Includes station names and platforms
        platformDetails: {
          origin: {
            platform: trip.departure.platform, // ✨ V7.1: From pattern default or trip override
            ...(trip.departure.platformDetails || {})
          },
          destination: {
            platform: trip.arrival.platform, // ✨ V7.1: From pattern default or trip override
            ...(trip.arrival.platformDetails || {})
          }
        }
      }));

      console.log(`[V7] Converted ${allDepartures.length} total trips to departure format`);
    } else {
      // V6 FORMAT: Use existing departures array
      allDepartures = routeData.departures || [];
      console.log(`[V6] Using ${allDepartures.length} departures from V6 format`);
    }

    // Filter departures by time window
    console.log(`[TIMING] Filtering departures at ${Date.now() - startTime}ms`);
    const filteredDepartures = filterDeparturesByTime(allDepartures, hours);
    console.log(`[TIMING] Filtered ${filteredDepartures.length} departures (before dedup) at ${Date.now() - startTime}ms`);

    // Deduplicate by unique departure time + headsign + platform
    // (Same service runs on multiple days, we only want today's instance)
    const uniqueDepartures = deduplicateDepartures(filteredDepartures);
    console.log(`[TIMING] Deduplicated to ${uniqueDepartures.length} departures at ${Date.now() - startTime}ms`);

    // Prepare response with station-level metadata
    const response = {
      origin: {
        ...stationData.station,
        requestedSlug: originSlug
      },
      destination: {
        ...routeData.destination,
        requestedSlug: destSlug
      },
      departures: uniqueDepartures,
      totalDepartures: uniqueDepartures.length,
      timeWindow: {
        hours,
        from: new Date().toISOString(),
        to: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      },
      generated: new Date().toISOString(),
      validUntil: new Date(Date.now() + CACHE_TTL * 1000).toISOString()
    };

    // REDIS DISABLED - rely on Vercel CDN caching via Cache-Control headers
    console.log(`[TIMING] Returning response at ${Date.now() - startTime}ms`);

    const responseTime = Date.now() - startTime;
    return jsonResponse({
      ...response,
      meta: {
        cached: false,
        responseTime: `${responseTime}ms`,
        architecture: 'station-slug', // Station slug architecture
        stationFile: `train-station-${originSlug}.json`,
        dataVersion: dataVersion, // V6 or V7 format
        apiVersion: '7.0'
      }
    });

  } catch (error) {
    console.error('API Error:', error);

    return jsonResponse({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
}

/**
 * Fetch station data from Vercel Blob Storage
 * Fetches per-station file containing ALL routes from that station
 */
async function fetchStationFromBlob(stationSlug) {
  try {
    const blobKey = `train-station-${stationSlug}.json`;
    const blobUrl = `https://qbd1awgw2y6szl69.public.blob.vercel-storage.com/${blobKey}`;

    console.log(`[BLOB] Fetching station file: ${blobUrl}`);

    const response = await fetch(blobUrl);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[BLOB NOT FOUND] ${blobKey} - Station file does not exist`);
        return null;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[BLOB FOUND] ${blobKey} - ${data.totalRoutes || 0} routes, ${Object.keys(data.routes || {}).length} destinations`);
    return data;

  } catch (error) {
    console.error(`[BLOB ERROR] ${error.message}`);
    return null;
  }
}

/**
 * Fetch pattern data from Vercel Blob Storage (V7 format only)
 * Patterns are separated from trips in V7 for better caching
 */
async function fetchPatternFromBlob(stationSlug) {
  try {
    const blobKey = `train-patterns-${stationSlug}.json`;
    const blobUrl = `https://qbd1awgw2y6szl69.public.blob.vercel-storage.com/${blobKey}`;

    console.log(`[BLOB] Fetching pattern file: ${blobUrl}`);

    const response = await fetch(blobUrl);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[BLOB NOT FOUND] ${blobKey} - Pattern file does not exist`);
        return null;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[BLOB FOUND] ${blobKey} - ${data.patterns?.length || 0} patterns`);
    return data;

  } catch (error) {
    console.error(`[BLOB ERROR] ${error.message}`);
    return null;
  }
}

/**
 * Deduplicate departures that represent the same service
 * GTFS data includes multiple service_ids for the same departure (different days of week)
 * We deduplicate by: time + headsign + origin platform
 */
function deduplicateDepartures(departures) {
  const seen = new Map();
  const unique = [];

  for (const dep of departures) {
    // Create unique key from departure time, headsign, and origin platform
    const key = `${dep.scheduledDeparture}|${dep.headsign}|${dep.platformDetails?.origin?.id || ''}`;

    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(dep);
    }
  }

  return unique;
}

/**
 * Filter departures by time window and sort chronologically
 * Handles time-only strings (e.g., "08:52:00") by combining with today's date in Brisbane timezone
 */
function filterDeparturesByTime(departures, hours) {
  // Get current time in Brisbane
  const nowBrisbane = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
  const cutoffBrisbane = new Date(nowBrisbane.getTime() + (hours * 60 * 60 * 1000));

  const todayYear = nowBrisbane.getFullYear();
  const todayMonth = nowBrisbane.getMonth();
  const todayDate = nowBrisbane.getDate();
  const currentHour = nowBrisbane.getHours();

  // Map departures to include calculated departure time for sorting
  const departuresWithTimes = departures.map(dep => {
    // Parse time string (HH:MM:SS)
    const [depHours, depMinutes, depSeconds] = dep.scheduledDeparture.split(':').map(Number);

    // Create departure time for today (in Brisbane timezone context)
    let depTime = new Date(todayYear, todayMonth, todayDate, depHours, depMinutes, depSeconds || 0);

    // If departure time appears to be in the past, check if it's tomorrow
    // (e.g., at 11:30 PM looking for a 1:00 AM train)
    if (depTime < nowBrisbane) {
      // Only roll to tomorrow if we're late evening (>= 8pm) or departure is early morning (<= 4am)
      if (currentHour >= 20 || depHours <= 4) {
        depTime = new Date(todayYear, todayMonth, todayDate + 1, depHours, depMinutes, depSeconds || 0);
      }
    }

    return { ...dep, _calculatedTime: depTime };
  });

  // Filter by time window and sort chronologically
  return departuresWithTimes
    .filter(dep => {
      const depTime = dep._calculatedTime;
      // Exclude if time is genuinely in the past
      if (depTime < nowBrisbane) return false;
      // Include if within time window
      return depTime >= nowBrisbane && depTime <= cutoffBrisbane;
    })
    .sort((a, b) => a._calculatedTime - b._calculatedTime)
    .map(({ _calculatedTime, ...dep }) => dep); // Remove temporary field
}

/**
 * Helper to create JSON responses
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200
        ? 'public, s-maxage=300, stale-while-revalidate=600'
        : 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
