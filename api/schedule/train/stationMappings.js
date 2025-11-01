/**
 * Station Mappings for Train API
 *
 * Provides platform-to-station lookup for backward-compatible API
 * This allows API to accept platform IDs but query station-level data
 */

import trainStationsGrouped from './train-stations-grouped.json' with { type: 'json' };

/**
 * Build platform-to-station mappings
 * @returns {{platformToStation: Map<string, object>, stationBySlug: Map<string, object>}}
 */
export function buildStationMappings() {
  const platformToStation = new Map(); // platform ID -> station object
  const stationBySlug = new Map(); // station slug -> station object

  trainStationsGrouped.stations.forEach(station => {
    const stationName = station.name;

    // Create URL-safe slug (e.g., "Bowen Hills station" -> "BOWEN_HILLS")
    const slug = stationName
      .replace(/\s+station$/i, '') // Remove " station" suffix
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_') // Replace non-alphanumeric with underscore
      .replace(/^_|_$/g, ''); // Trim leading/trailing underscores

    const stationObj = {
      name: stationName,
      slug: slug,
      platforms: station.stopIds
    };

    stationBySlug.set(slug, stationObj);

    // Map each platform ID to this station
    station.stopIds.forEach(platformId => {
      platformToStation.set(platformId, stationObj);
    });
  });

  return { platformToStation, stationBySlug };
}

// Build once at module load
const { platformToStation, stationBySlug } = buildStationMappings();

/**
 * Get station info from a platform ID
 * @param {string} platformId - Platform stop ID (e.g., "600005")
 * @returns {object|null} Station object or null if not found
 */
export function getStationFromPlatform(platformId) {
  return platformToStation.get(platformId) || null;
}

/**
 * Get station info from a slug
 * @param {string} slug - Station slug (e.g., "BOWEN_HILLS")
 * @returns {object|null} Station object or null if not found
 */
export function getStationFromSlug(slug) {
  return stationBySlug.get(slug) || null;
}

/**
 * Generate route file key from two platform IDs
 * @param {string} originPlatformId - Origin platform ID
 * @param {string} destPlatformId - Destination platform ID
 * @returns {string|null} Route file key (e.g., "BOWEN_HILLS-FORTITUDE_VALLEY") or null
 */
export function getRouteKeyFromPlatforms(originPlatformId, destPlatformId) {
  const originStation = getStationFromPlatform(originPlatformId);
  const destStation = getStationFromPlatform(destPlatformId);

  if (!originStation || !destStation) {
    return null;
  }

  return `${originStation.slug}-${destStation.slug}`;
}
