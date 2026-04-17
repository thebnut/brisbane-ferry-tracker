import WRAPPED_VESSELS from '../data/wrappedVessels.json';

/**
 * Look up wrap metadata for a given GTFS-RT vehicle id.
 *
 * GTFS-RT feed `vehicle.id` is in the form "<hash>_<VesselName>" — we match against
 * the trailing segment, case-insensitively.
 *
 * Known feed quirks to be aware of when adding new wrapped vessels:
 *  - Casing is inconsistent (some vessels appear in ALL CAPS, others mixed case).
 *    Keep `vesselName` in the JSON however you like — the match ignores case.
 *  - Multi-word vessel names (e.g. "Neville Bonner") are truncated to the first
 *    word in the feed (e.g. `<hash>_Neville`). Use the first word only.
 *  - Ferries with an "II" suffix (e.g. "Mooroolbin II") appear WITHOUT the suffix
 *    in some feed snapshots. If both I and II should be distinguishable, you'll
 *    need another field to disambiguate — out of scope for v1.
 *
 * @param {string|null|undefined} vehicleId - GTFS-RT vehicle.id
 * @returns {object|null} wrap entry { vesselName, wrap, description, emoji, color, sinceDate, sourceUrl }, or null
 */
export function getVesselWrap(vehicleId) {
  if (!vehicleId || typeof vehicleId !== 'string') return null;
  const parts = vehicleId.split('_');
  if (parts.length < 2) return null;
  const nameFromFeed = parts[parts.length - 1].toLowerCase();
  return WRAPPED_VESSELS.find((w) => w.vesselName.toLowerCase() === nameFromFeed) ?? null;
}
