/**
 * Serverless cache endpoint for GTFS-RT data
 * Reduces API load by caching data for multiple clients
 * Filters by transit mode (ferry, train, bus)
 */

import { gtfsCache } from '../../lib/gtfsCache.js';

// Mode configurations - minimal for now, will expand with config system
const MODE_CONFIGS = {
  ferry: {
    routeType: 4,
    routeFilter: (routeId) => routeId && routeId.startsWith('F'),
    ttl: 30, // seconds
  },
  train: {
    routeType: 2,
    routeFilter: (routeId) => routeId && !routeId.startsWith('F'),
    ttl: 30,
  },
  bus: {
    routeType: 3,
    routeFilter: (routeId) => routeId && /^\d+$/.test(routeId),
    ttl: 30,
  }
};

/**
 * Fetch GTFS-RT data from TransLink API
 */
async function fetchGTFSRT(endpoint) {
  const baseUrl = 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/';
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TransLink API error: ${response.status}`);
  }

  return response.arrayBuffer();
}

/**
 * Filter GTFS-RT entities by route type
 */
function filterByMode(data) {
  // This is a simplified filter - in production we'd parse the protobuf
  // and filter the entities properly
  // For now, we'll pass through the raw data
  return data;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Extract mode from dynamic route
  const { mode } = req.query;

  // Validate mode
  if (!mode || !MODE_CONFIGS[mode]) {
    return res.status(400).json({
      error: 'Invalid mode. Must be one of: ferry, train, bus'
    });
  }

  const modeConfig = MODE_CONFIGS[mode];
  const { endpoint = 'TripUpdates' } = req.query;

  // Create cache key
  const cacheKey = `${mode}:${endpoint}`;

  try {
    // Check cache first
    const cached = await gtfsCache.get(cacheKey);
    if (cached && !gtfsCache.isStale(cached, modeConfig.ttl)) {
      // Add cache headers
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000));
      res.setHeader('Cache-Control', `s-maxage=${modeConfig.ttl}, stale-while-revalidate`);

      // Return cached data
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(Buffer.from(cached.data));
    }

    // Cache miss - fetch from TransLink
    console.log(`Cache miss for ${cacheKey}, fetching from TransLink...`);
    const data = await fetchGTFSRT(endpoint);

    // Filter by mode (simplified for now)
    const filtered = filterByMode(data, modeConfig);

    // Store in cache
    await gtfsCache.set(cacheKey, filtered);

    // Add cache headers
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', `s-maxage=${modeConfig.ttl}, stale-while-revalidate`);

    // Return data
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from(filtered));

  } catch (error) {
    console.error(`Error fetching GTFS-RT for ${mode}:`, error);

    // Try to return stale cache if available
    const stale = await gtfsCache.get(cacheKey);
    if (stale) {
      console.log('Returning stale cache due to error');
      res.setHeader('X-Cache', 'STALE');
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(Buffer.from(stale.data));
    }

    // No cache available - return error
    res.status(500).json({
      error: 'Failed to fetch transit data',
      details: error.message
    });
  }
}
