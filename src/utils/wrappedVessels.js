import WRAPPED_VESSELS from '../data/wrappedVessels.json';
import blueyUrl from '../assets/wraps/bluey.svg?url';
import bingoUrl from '../assets/wraps/bingo.svg?url';
import blueyRaw from '../assets/wraps/bluey.svg?raw';
import bingoRaw from '../assets/wraps/bingo.svg?raw';

// Map `iconKey` from the JSON to the actual asset. Keeping this in one place
// means adding a new wrap is a JSON edit + one new import pair here.
const ICONS = {
  bluey: { url: blueyUrl, svg: blueyRaw },
  bingo: { url: bingoUrl, svg: bingoRaw },
};

/**
 * Look up wrap metadata for a given GTFS-RT vehicle id.
 *
 * GTFS-RT feed `vehicle.id` is in the form "<hash>_<VesselName>" — we match against
 * everything after the LAST underscore, case-insensitively. The trailing segment
 * can include literal spaces (e.g. "<hash>_Neville Bonner" or "<hash>_Binkinba II")
 * — those come through intact on matching.
 *
 * Known feed quirks when adding new wrapped vessels:
 *  - Casing is inconsistent (some vessels appear in ALL CAPS, others mixed case).
 *    Keep `vesselName` in the JSON however you like — the match ignores case.
 *  - For vessels with a generational suffix ("Mooroolbin II" vs the retired "Mooroolbin"),
 *    match the currently-active one. Both versions rarely co-exist in the live feed.
 *
 * @param {string|null|undefined} vehicleId - GTFS-RT vehicle.id
 * @returns {object|null} wrap entry { vesselName, wrap, description, color, sinceDate, sourceUrl, iconUrl, iconSvg }, or null
 */
export function getVesselWrap(vehicleId) {
  if (!vehicleId || typeof vehicleId !== 'string') return null;
  const parts = vehicleId.split('_');
  if (parts.length < 2) return null;
  const nameFromFeed = parts[parts.length - 1].toLowerCase();
  const entry = WRAPPED_VESSELS.find((w) => w.vesselName.toLowerCase() === nameFromFeed);
  if (!entry) return null;
  const icon = ICONS[entry.iconKey];
  return {
    ...entry,
    iconUrl: icon?.url ?? null,
    iconSvg: icon?.svg ?? null,
  };
}
