/**
 * Train Schedule API - Route Query Endpoint
 *
 * Query train schedules between two stations with intelligent caching
 *
 * Usage: /api/schedule/train/route?origin=600016&destination=600029&hours=24
 *
 * Phase 2: API Infrastructure
 * Completely separate from ferry production systems
 */

import { kv } from '@vercel/kv';
import { list, head } from '@vercel/blob';

const CACHE_TTL = 300; // 5 minutes in seconds
const DEFAULT_HOURS = 24; // Default time window for departures

export const config = {
  runtime: 'edge', // Use edge runtime for fast response times
};

/**
 * Main handler for train route queries
 */
export default async function handler(req) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(req.url);
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
        example: '/api/schedule/train/route?origin=600016&destination=600029&hours=24'
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

    // Check cache first
    const cacheKey = `train:route:${origin}:${destination}:${date}:${hours}`;
    const cached = await getCachedRoute(cacheKey);

    if (cached) {
      const responseTime = Date.now() - startTime;
      return jsonResponse({
        ...cached,
        meta: {
          cached: true,
          responseTime: `${responseTime}ms`,
          cacheKey
        }
      });
    }

    // Fetch from Blob Storage
    const routeData = await fetchRouteFromBlob(origin, destination);

    if (!routeData) {
      return jsonResponse({
        error: 'Route not found',
        message: 'No direct route exists between these stations',
        origin,
        destination,
        suggestion: 'Try different stations or check if a transfer is required'
      }, 404);
    }

    // Filter departures by time window
    const filteredData = filterDeparturesByTime(routeData, hours);

    // Prepare response
    const response = {
      origin: filteredData.origin,
      destination: filteredData.destination,
      departures: filteredData.departures,
      totalDepartures: filteredData.departures.length,
      timeWindow: {
        hours,
        from: new Date().toISOString(),
        to: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      },
      generated: new Date().toISOString(),
      validUntil: new Date(Date.now() + CACHE_TTL * 1000).toISOString()
    };

    // Cache the response
    await cacheRoute(cacheKey, response);

    const responseTime = Date.now() - startTime;
    return jsonResponse({
      ...response,
      meta: {
        cached: false,
        responseTime: `${responseTime}ms`,
        cacheKey
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
 * Get cached route data from Vercel KV
 */
async function getCachedRoute(key) {
  try {
    const cached = await kv.get(key);

    if (!cached) {
      console.log(`[CACHE MISS] ${key}`);
      return null;
    }

    console.log(`[CACHE HIT] ${key}`);
    return cached;
  } catch (error) {
    console.error('Cache read error:', error);
    return null; // Fail gracefully
  }
}

/**
 * Cache route data in Vercel KV
 */
async function cacheRoute(key, data) {
  try {
    await kv.set(key, data, { ex: CACHE_TTL });
    console.log(`[CACHED] ${key} for ${CACHE_TTL}s`);
  } catch (error) {
    console.error('Cache write error:', error);
    // Don't fail the request if caching fails
  }
}

/**
 * Fetch route data from Vercel Blob Storage
 */
async function fetchRouteFromBlob(origin, destination) {
  try {
    const blobKey = `train-${origin}-${destination}.json`;

    // Try to get the blob
    const blob = await head(blobKey);

    if (!blob) {
      console.log(`[BLOB NOT FOUND] ${blobKey}`);
      return null;
    }

    // Fetch the actual data
    const response = await fetch(blob.url);
    const data = await response.json();

    console.log(`[BLOB FOUND] ${blobKey} - ${data.departures?.length || 0} departures`);
    return data;

  } catch (error) {
    console.error('Blob fetch error:', error);
    return null;
  }
}

/**
 * Filter departures by time window
 */
function filterDeparturesByTime(routeData, hours) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + (hours * 60 * 60 * 1000));

  const filteredDepartures = routeData.departures.filter(dep => {
    const depTime = new Date(dep.scheduledDeparture);
    return depTime >= now && depTime <= cutoff;
  });

  return {
    ...routeData,
    departures: filteredDepartures
  };
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
