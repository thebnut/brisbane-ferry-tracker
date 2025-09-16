/**
 * Serverless cache endpoint for GTFS-RT data
 * Reduces API load by caching data for multiple clients
 * Filters by transit mode (ferry, train, bus)
 */

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
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
function filterByMode(buffer, modeConfig) {
  try {
    // Parse the protobuf data
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    // Log original entity count
    console.log(`Original entities: ${feed.entity.length}`);

    // Filter entities by route
    const filteredEntities = feed.entity.filter(entity => {
      // Check TripUpdate entities
      if (entity.tripUpdate?.trip?.routeId) {
        return modeConfig.routeFilter(entity.tripUpdate.trip.routeId);
      }
      // Check VehiclePosition entities
      if (entity.vehicle?.trip?.routeId) {
        return modeConfig.routeFilter(entity.vehicle.trip.routeId);
      }
      // Keep all alerts (they might be system-wide)
      if (entity.alert) {
        return true;
      }
      // Filter out entities without route information
      return false;
    });

    console.log(`Filtered entities: ${filteredEntities.length} (${modeConfig.routeType})`);

    // Create new feed with filtered entities
    const filteredFeed = {
      header: feed.header,
      entity: filteredEntities
    };

    // Encode back to protobuf
    const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.create(filteredFeed);
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
  } catch (error) {
    console.error('Error filtering GTFS data:', error);
    // Return original data if filtering fails
    return buffer;
  }
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

  // Log request for monitoring
  console.log({
    action: 'request',
    mode,
    endpoint,
    timestamp: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress
  });

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

    // Filter by mode
    const filtered = filterByMode(data, modeConfig);

    // Store in cache
    await gtfsCache.set(cacheKey, filtered);

    // Count entities for monitoring
    let entityCount = 0;
    try {
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(filtered)
      );
      entityCount = feed.entity.length;
    } catch (e) {
      console.error('Could not count entities:', e);
    }

    // Add cache headers
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Mode', mode);
    res.setHeader('X-Entities-Count', entityCount);
    res.setHeader('Cache-Control', `s-maxage=${modeConfig.ttl}, stale-while-revalidate`);

    // Return data
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from(filtered));

  } catch (error) {
    console.error(`Error fetching GTFS-RT for ${mode}:`, error);
    console.error('Stack trace:', error.stack);

    // Try to return stale cache if available
    const stale = await gtfsCache.get(cacheKey);
    if (stale) {
      console.log('Returning stale cache due to error');
      res.setHeader('X-Cache', 'STALE');
      res.setHeader('X-Error', 'true');
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(Buffer.from(stale.data));
    }

    // No cache available - return error
    res.status(500).json({
      error: 'Failed to fetch transit data',
      details: error.message,
      mode: mode,
      endpoint: endpoint
    });
  }
}