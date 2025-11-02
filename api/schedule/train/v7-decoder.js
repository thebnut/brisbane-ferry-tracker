/**
 * V7/V7.1 Data Format Decoder Utilities
 *
 * Converts V7/V7.1 minified format to client-friendly format:
 * - Minutes since midnight → HH:MM:SS
 * - Integer pattern IDs → full pattern objects
 * - Minified field names → readable names
 * - Array-indexed dates → date strings
 * - V7.1: Platform defaults (pattern) + overrides (trip) → final platform values
 *
 * V7.1 minified trip format:
 * {
 *   t: "34564095-QR 25_26-40750-1804",  // tripId (kept for realtime)
 *   d: 401,    // departure minutes (06:41)
 *   a: 404,    // arrival minutes (06:44)
 *   p: 142,    // pattern integer ID
 *   s: [404, 406, 408],  // stop times as minutes
 *   op: "2",   // OPTIONAL: origin platform override (V7.1)
 *   ap: "1"    // OPTIONAL: arrival platform override (V7.1)
 * }
 *
 * Expanded format:
 * {
 *   tripId: "34564095-QR 25_26-40750-1804",
 *   departure: { time: "06:41:00", platform: "1" },  // from pattern.op or trip.op
 *   arrival: { time: "06:44:00", platform: "1" },    // from pattern.dp or trip.ap
 *   patternId: 142,
 *   stopTimes: [{arrival: "06:44:00", departure: "06:44:00"}, ...]
 * }
 */

/**
 * Convert minutes since midnight to HH:MM:SS time string
 */
export function minutesToTime(minutes) {
  if (typeof minutes !== 'number' || minutes < 0) {
    return '00:00:00';
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

/**
 * Get date string from day offset
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {number} dayOffset - Days from start (0 = start date)
 */
export function getDayOffset(startDate, targetDate) {
  const start = new Date(startDate + 'T00:00:00');
  const target = new Date(targetDate + 'T00:00:00');
  const diffMs = target - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Expand V7 minified trip to client-friendly format
 * @param {object} minTrip - Minified V7 trip
 * @param {object} meta - Metadata with field mappings
 * @param {object} pattern - Pattern object (optional, for stop details)
 * @param {object} patternMeta - Pattern metadata with stopFields mapping
 */
export function expandTrip(minTrip, meta = {}, pattern = null, patternMeta = null) {
  if (!minTrip) return null;

  // V7.1: Determine platform from override or pattern default
  const originPlatform = minTrip.op || pattern?.op || null;
  const destPlatform = minTrip.ap || pattern?.dp || null;

  const expanded = {
    tripId: minTrip.t,
    departure: {
      time: minutesToTime(minTrip.d),
      platform: originPlatform, // ✨ V7.1: Platform from override or pattern default
      platformDetails: {}
    },
    arrival: {
      time: minutesToTime(minTrip.a),
      platform: destPlatform, // ✨ V7.1: Platform from override or pattern default
      platformDetails: {}
    },
    patternId: minTrip.p
  };

  // Expand stop times with station details from pattern
  if (minTrip.s && Array.isArray(minTrip.s) && pattern && pattern.s) {
    const stopFields = patternMeta?.stopFields || ['station', 'name', 'platformId', 'platform', 'platformName'];

    expanded.stopTimes = minTrip.s.map((minutes, idx) => {
      const stopArray = pattern.s[idx];
      if (!stopArray) {
        return {
          arrival: minutesToTime(minutes),
          departure: minutesToTime(minutes)
        };
      }

      // Map array to object using stopFields
      const stopObj = {};
      stopFields.forEach((field, fieldIdx) => {
        stopObj[field] = stopArray[fieldIdx];
      });

      return {
        arrival: minutesToTime(minutes),
        departure: minutesToTime(minutes),
        stopId: stopObj.platformId,
        stopName: stopObj.name,
        platform: stopObj.platform,
        platformName: stopObj.platformName,
        station: stopObj.station
      };
    });
  } else if (minTrip.s && Array.isArray(minTrip.s)) {
    // No pattern data, just times
    expanded.stopTimes = minTrip.s.map(minutes => ({
      arrival: minutesToTime(minutes),
      departure: minutesToTime(minutes)
    }));
  }

  // If pattern provided, add route details
  if (pattern) {
    expanded.routeId = pattern.r;
    expanded.routeName = pattern.n;
    expanded.headsign = `${pattern.n} to ${pattern.d}`;
  }

  return expanded;
}

/**
 * Expand V7 station file to V6-compatible format
 * Converts array-indexed dates and minified trips to full format
 *
 * @param {object} v7StationData - V7 station file
 * @param {object} v7PatternsData - V7 patterns file (optional)
 */
export function expandStationData(v7StationData, v7PatternsData = null) {
  if (!v7StationData || !v7StationData.meta || !isV7Format(v7StationData)) {
    // Already expanded or invalid format
    return v7StationData;
  }

  const { meta, station, routes } = v7StationData;
  const { start: startDate, days } = meta;

  // Build pattern lookup if available
  const patternLookup = new Map();
  if (v7PatternsData && v7PatternsData.patterns) {
    v7PatternsData.patterns.forEach(pattern => {
      patternLookup.set(pattern.i, pattern);
    });
  }

  // Expand routes
  const expandedRoutes = {};

  for (const [destSlug, routeData] of Object.entries(routes)) {
    const { destination, schedules } = routeData;

    // Convert array-indexed schedules to date-keyed schedules
    const expandedSchedules = {};

    schedules.forEach((dayTrips, dayOffset) => {
      // Calculate date for this day offset
      const date = new Date(startDate + 'T00:00:00');
      date.setDate(date.getDate() + dayOffset);
      const dateStr = date.toISOString().split('T')[0];

      // Expand each trip for this day
      expandedSchedules[dateStr] = dayTrips.map(minTrip => {
        const pattern = patternLookup.get(minTrip.p);
        return expandTrip(minTrip, meta, pattern);
      });
    });

    expandedRoutes[destSlug] = {
      destination,
      schedules: expandedSchedules
    };
  }

  return {
    station,
    totalRoutes: Object.keys(expandedRoutes).length,
    routes: expandedRoutes,
    version: '7.0-expanded',
    generated: new Date().toISOString()
  };
}

/**
 * Get trips for a specific date from V7 station data
 * Optimized: doesn't expand entire file, just the requested date
 *
 * @param {object} v7StationData - V7 station file
 * @param {string} destSlug - Destination station slug
 * @param {string} targetDate - ISO date string (YYYY-MM-DD)
 * @param {object} v7PatternsData - V7 patterns file (optional)
 */
export function getTripsForDate(v7StationData, destSlug, targetDate, v7PatternsData = null) {
  if (!v7StationData || !v7StationData.meta) {
    return [];
  }

  const { meta, routes } = v7StationData;

  // Check if this is V7/V7.1 format
  if (!isV7Format(v7StationData)) {
    // V6 or earlier format - use old logic
    const routeData = routes[destSlug];
    if (!routeData || !routeData.schedules) return [];
    return routeData.schedules[targetDate] || [];
  }

  // V7 format - use array indexing
  const { start: startDate } = meta;
  const routeData = routes[destSlug];

  if (!routeData || !routeData.schedules) {
    return [];
  }

  // Calculate day offset
  const dayOffset = getDayOffset(startDate, targetDate);

  if (dayOffset < 0 || dayOffset >= routeData.schedules.length) {
    return []; // Date out of range
  }

  // Get trips for this day offset
  const dayTrips = routeData.schedules[dayOffset];

  if (!dayTrips || dayTrips.length === 0) {
    return [];
  }

  // Build pattern lookup if available
  const patternLookup = new Map();
  const patternMeta = v7PatternsData?.meta || null;
  if (v7PatternsData && v7PatternsData.patterns) {
    v7PatternsData.patterns.forEach(pattern => {
      patternLookup.set(pattern.i, pattern);
    });
  }

  // Expand trips
  return dayTrips.map(minTrip => {
    const pattern = patternLookup.get(minTrip.p);
    return expandTrip(minTrip, meta, pattern, patternMeta);
  });
}

/**
 * Check if data is V7/V7.1 format
 */
export function isV7Format(data) {
  return data && data.meta && (data.meta.v === '7.0' || data.meta.v === '7.1');
}

/**
 * Convert V7 pattern data to V6-compatible format
 */
export function expandPatternData(v7PatternsData) {
  if (!v7PatternsData || !v7PatternsData.meta || !isV7Format(v7PatternsData)) {
    return v7PatternsData; // Already expanded or invalid
  }

  const { meta, patterns } = v7PatternsData;
  const { stopFields } = meta;

  // Expand patterns
  const expandedPatterns = {};

  patterns.forEach(pattern => {
    const patternId = `pattern-${pattern.i}`; // Create string ID

    expandedPatterns[patternId] = {
      patternId,
      routeId: pattern.r,
      routeName: pattern.n,
      destination: pattern.d,
      stops: pattern.s.map(stopArray => {
        // Convert array to object using stopFields mapping
        const stop = {};
        stopFields.forEach((field, idx) => {
          stop[field] = stopArray[idx];
        });
        return stop;
      }),
      tripCount: pattern.c
    };
  });

  return {
    origin: meta.origin,
    totalPatterns: patterns.length,
    patterns: expandedPatterns,
    version: '7.0-expanded',
    generated: new Date().toISOString()
  };
}
