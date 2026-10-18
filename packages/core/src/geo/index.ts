/**
 * Geohash and distance helpers for nearby stops without a server (ADR-0004): geohash-5 tiles (about 4.9 × 4.9 km),
 * the tile you are in plus its 8 neighbours, sorted by haversine distance. Fetching the neighbours is what keeps
 * results right at tile edges: a stop 50 m away across a cell boundary lives in another file. Shared by the bus app's
 * nearby page and BrisbaneTransit's "Around you"; the encoder matches the pipeline's.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/** Standard geohash (base32, longitude bit first); identical to the pipeline's encoder. */
export function geohashEncode(lat: number, lon: number, precision = 5): string {
  let latLo = -90
  let latHi = 90
  let lonLo = -180
  let lonHi = 180
  let out = ''
  let bit = 0
  let ch = 0
  let even = true
  while (out.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2
      if (lon >= mid) {
        ch = (ch << 1) | 1
        lonLo = mid
      } else {
        ch <<= 1
        lonHi = mid
      }
    } else {
      const mid = (latLo + latHi) / 2
      if (lat >= mid) {
        ch = (ch << 1) | 1
        latLo = mid
      } else {
        ch <<= 1
        latHi = mid
      }
    }
    even = !even
    if (++bit === 5) {
      out += BASE32[ch]
      bit = 0
      ch = 0
    }
  }
  return out
}

export interface Box {
  latLo: number
  latHi: number
  lonLo: number
  lonHi: number
}

export function geohashBounds(hash: string): Box {
  let latLo = -90
  let latHi = 90
  let lonLo = -180
  let lonHi = 180
  let even = true
  for (const c of hash) {
    const v = BASE32.indexOf(c)
    if (v < 0) throw new Error(`bad geohash ${hash}`)
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1
      if (even) {
        const mid = (lonLo + lonHi) / 2
        if (on) lonLo = mid
        else lonHi = mid
      } else {
        const mid = (latLo + latHi) / 2
        if (on) latLo = mid
        else latHi = mid
      }
      even = !even
    }
  }
  return { latLo, latHi, lonLo, lonHi }
}

/** The cell itself and its 8 neighbours (centre first), without duplicates. */
export function geohashNeighbourhood(hash: string): string[] {
  const b = geohashBounds(hash)
  const dLat = b.latHi - b.latLo
  const dLon = b.lonHi - b.lonLo
  const cLat = (b.latLo + b.latHi) / 2
  const cLon = (b.lonLo + b.lonHi) / 2
  const out = [hash]
  for (const dy of [-1, 0, 1])
    for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue
      const lat = Math.max(-89.999999, Math.min(89.999999, cLat + dy * dLat))
      let lon = cLon + dx * dLon
      if (lon >= 180) lon -= 360
      if (lon < -180) lon += 360
      const h = geohashEncode(lat, lon, hash.length)
      if (!out.includes(h)) out.push(h)
    }
  return out
}

const R = 6_371_008.8

/** Great-circle distance in metres. */
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLon = (bLon - aLon) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface Located {
  key: string
  lat: number
  lon: number
}

/** Stops from the tiles sorted by distance from (lat, lon), nearest first, de-duplicated by key. */
export function nearest<T extends Located>(
  lat: number,
  lon: number,
  stops: Iterable<T>,
  opts: { limit?: number; maxMetres?: number } = {},
): Array<T & { metres: number }> {
  const seen = new Set<string>()
  const out: Array<T & { metres: number }> = []
  for (const s of stops) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    const metres = haversine(lat, lon, s.lat, s.lon)
    if (opts.maxMetres != null && metres > opts.maxMetres) continue
    out.push({ ...s, metres })
  }
  out.sort((a, b) => a.metres - b.metres || (a.key < b.key ? -1 : 1))
  return opts.limit ? out.slice(0, opts.limit) : out
}

/**
 * Geohash cells covering a bounding box (the map's visible stops layer), or null when more than `max` cells would
 * be needed (zoomed out too far to draw stops).
 */
export function cellsCovering(
  b: { west: number; south: number; east: number; north: number },
  precision = 5,
  max = 16,
): string[] | null {
  const sample = geohashBounds(geohashEncode(b.south, b.west, precision))
  const dLat = sample.latHi - sample.latLo
  const dLon = sample.lonHi - sample.lonLo
  const rows = Math.ceil((b.north - sample.latLo) / dLat)
  const cols = Math.ceil((b.east - sample.lonLo) / dLon)
  if (rows * cols > max) return null
  const out: string[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const h = geohashEncode(sample.latLo + (r + 0.5) * dLat, sample.lonLo + (c + 0.5) * dLon, precision)
      if (!out.includes(h)) out.push(h)
    }
  return out
}
