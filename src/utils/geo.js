// Pure geographic utilities — no React, no Capacitor, just math.
//
// Used by:
// - useNearestStop (BRI-26 iOS nearest-terminal flow)
// - FerryMap (BRI-38 distance-based vehicle filter)

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine great-circle distance in metres. Accurate enough for "which
// ferry terminal is closest" — error << terminal spacing within Brisbane.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// terminals: [{ lat, lng, ... }]
// Returns the closest terminal (preserving original fields) plus an integer
// distanceMeters, or null if the input list is empty.
export function findNearestTerminal(lat, lng, terminals) {
  let best = null;
  let bestDist = Infinity;
  for (const t of terminals) {
    const d = haversineMeters(lat, lng, t.lat, t.lng);
    if (d < bestDist) {
      bestDist = d;
      best = { ...t, distanceMeters: Math.round(d) };
    }
  }
  return best;
}
