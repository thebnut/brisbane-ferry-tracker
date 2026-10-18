const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/** Standard geohash (base32, longitude bit first). Precision 5 ≈ 4.9 km × 4.9 km cells. */
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
