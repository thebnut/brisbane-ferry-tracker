# ADR-0004: Client-side stop search and geohash-tiled nearby

Status: Proposed, 18 October 2026.

## Context
- Search must cover 32 ferry, 154 train and about 12.4k bus stops.
- Measured stop indexes, gzipped: ferry 0.7 KB, train 6 KB, bus 214 KB.

## Decision
- **Search:**
  - Each app lazy-loads its stop index after first paint and the service worker caches it.
  - Fuzzy matching uses `@leeoniya/ufuzzy` 1.0.19, with exact matching on stop numbers.
  - The UI is a headless combobox (Ark UI or Radix) with a portal.
- **Nearby:**
  - The client fetches geohash-5 tiles, its own plus 8 neighbours, as static assets, then sorts by haversine distance.
- **Map:** the bus stops map layer comes from PMTiles on R2.

## Alternatives
- **A server-side search API:** per-keystroke requests and cold starts.
- **Algolia or Elastic:** cost.
- **MiniSearch or FlexSearch:** larger, and built for full-text search rather than short names.
- **Fuse.js:** slower on 12k items.

## Consequences
- Search works offline, at zero marginal cost.
- Address and POI geocoding, if multimodal ever needs it, goes behind `/v1/geocode`, decided later.
