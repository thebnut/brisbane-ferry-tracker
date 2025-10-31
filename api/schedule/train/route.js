/**
 * Train Schedule API - Route Query Endpoint
 * VERSION: 2.0 - URL Parsing Fixed
 *
 * Query train schedules between two stations with intelligent caching
 *
 * Usage: /api/schedule/train/route?origin=600016&destination=600029&hours=24
 *
 * Phase 2: API Infrastructure
 * Completely separate from ferry production systems
 *
 * Runtime: Node.js (not Edge)
 * Reason: Redis Cloud uses native protocol (TCP) which requires Node.js modules
 * Performance: ~100-200ms response (still fast, benefits from Redis caching)
 */

import { createClient } from 'redis';
import https from 'https';
// Note: Not using @vercel/blob SDK - fetching directly via public URLs

const CACHE_TTL = 300; // 5 minutes in seconds
const DEFAULT_HOURS = 24; // Default time window for departures

// HTTP agent for connection reuse (reduces latency)
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 5,
  maxFreeSockets: 2
});

// Lazy Redis connection (singleton pattern)
// Avoids reconnecting on every serverless invocation
let redisClient = null;
let redisConnecting = false;

async function getRedis() {
  // Return existing connected client
  if (redisClient?.isOpen) {
    return redisClient;
  }

  // Wait if connection is in progress
  if (redisConnecting) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return getRedis(); // Retry after waiting
  }

  try {
    redisConnecting = true;

    // Create new client with timeout configuration
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 5000, // 5 second timeout
        keepAlive: 5000,
        reconnectStrategy: (retries) => {
          // Exponential backoff up to 3 seconds
          return Math.min(retries * 100, 3000);
        }
      }
    });

    // Connect with timeout
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      )
    ]);

    console.log('[REDIS] Connected successfully');
    return redisClient;

  } catch (error) {
    console.error('[REDIS] Connection failed:', error.message);
    redisClient = null;
    throw error;
  } finally {
    redisConnecting = false;
  }
}

// Vercel function configuration
export const config = {
  runtime: 'nodejs', // Edge runtime doesn't support native Redis (TCP connections)
  maxDuration: 60, // 60 seconds timeout
  // Force rebuild - Version 2.0
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

    // DISABLE REDIS: Just fetch from blob directly
    // Redis connection causes 60s timeout after response is sent
    console.log(`[TIMING] Fetching blob at ${Date.now() - startTime}ms`);

    const routeData = await fetchRouteFromBlob(origin, destination);
    console.log(`[TIMING] Blob fetched at ${Date.now() - startTime}ms`);

    if (!routeData) {
      console.log(`[TIMING] Returning 404 at ${Date.now() - startTime}ms`);
      // Close any pending operations before returning
      if (redisClient?.isOpen) {
        redisClient.quit().catch(() => {}); // Best effort close
      }
      return jsonResponse({
        error: 'Route not found',
        message: 'No direct route exists between these stations',
        origin,
        destination,
        suggestion: 'Try different stations or check if a transfer is required'
      }, 404);
    }

    // Filter departures by time window
    console.log(`[TIMING] Filtering departures at ${Date.now() - startTime}ms`);
    const filteredData = filterDeparturesByTime(routeData, hours);
    console.log(`[TIMING] Filtered ${filteredData.departures.length} departures at ${Date.now() - startTime}ms`);

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

    // REDIS DISABLED - rely on Vercel CDN caching via Cache-Control headers
    console.log(`[TIMING] Returning response at ${Date.now() - startTime}ms`);

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
 * Get cached route data from Redis
 */
async function getCachedRoute(key) {
  try {
    const redis = await getRedis();
    const cached = await redis.get(key);

    if (!cached) {
      console.log(`[CACHE MISS] ${key}`);
      return null;
    }

    console.log(`[CACHE HIT] ${key}`);
    // Redis stores as string, parse back to object
    return JSON.parse(cached);
  } catch (error) {
    console.error('[CACHE] Read error:', error.message);
    return null; // Fail gracefully - continue without cache
  }
}

/**
 * Cache route data in Redis
 */
async function cacheRoute(key, data) {
  try {
    const redis = await getRedis();
    // Redis requires string values, so stringify the data
    // node-redis v4 uses setEx for setting with expiration
    await redis.setEx(key, CACHE_TTL, JSON.stringify(data));
    console.log(`[CACHED] ${key} for ${CACHE_TTL}s`);
  } catch (error) {
    console.error('[CACHE] Write error:', error.message);
    // Don't fail the request if caching fails
  }
}

/**
 * Fetch route data from Vercel Blob Storage
 * Uses direct public URL to bypass head() which was timing out
 */
async function fetchRouteFromBlob(origin, destination) {
  try {
    const blobKey = `train-${origin}-${destination}.json`;

    // Construct direct public blob URL
    // Pattern from existing blobs: https://qbd1awgw2y6szl69.public.blob.vercel-storage.com/{filename}
    const blobUrl = `https://qbd1awgw2y6szl69.public.blob.vercel-storage.com/${blobKey}`;

    console.log(`[BLOB] Fetching directly: ${blobUrl}`);

    // Fetch directly with timeout and connection reuse
    const response = await Promise.race([
      fetch(blobUrl, { agent: httpsAgent }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Blob fetch timeout after 10s')), 10000)
      )
    ]);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[BLOB NOT FOUND] ${blobKey}`);
        return null;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[BLOB FOUND] ${blobKey} - ${data.departures?.length || 0} departures`);
    return data;

  } catch (error) {
    console.error(`[BLOB ERROR] ${error.message}`);
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
