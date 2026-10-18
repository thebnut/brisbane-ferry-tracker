/**
 * Browser geolocation as state, with the permission UX the nearby pages share (bus /nearby, transit "Around you"):
 * locate straight away only when permission was already granted; otherwise wait for the user to ask, so the browser
 * prompt never appears unexplained. A `fixed` position (?lat=&lon=, a chosen stop) skips GPS entirely.
 */
import { useEffect, useState } from 'react'

export type GeoState =
  | { state: 'idle' | 'locating' | 'denied' | 'unavailable' }
  | { state: 'ok'; lat: number; lon: number; accuracy: number | null }

export function useGeolocation(fixed: { lat: number; lon: number } | null = null) {
  const [geo, setGeo] = useState<GeoState>(
    fixed ? { state: 'ok', ...fixed, accuracy: null } : { state: 'idle' },
  )
  const locate = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator))
      return setGeo({ state: 'unavailable' })
    setGeo({ state: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setGeo({ state: 'ok', lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setGeo({ state: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }
  const hasFixed = fixed != null
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount.
  useEffect(() => {
    if (hasFixed) return
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') locate()
        else if (p.state === 'denied') setGeo({ state: 'denied' })
      })
      .catch(() => {})
  }, [])
  const fLat = fixed?.lat
  const fLon = fixed?.lon
  useEffect(() => {
    if (fLat != null && fLon != null) setGeo({ state: 'ok', lat: fLat, lon: fLon, accuracy: null })
  }, [fLat, fLon])
  return { geo, locate, setGeo }
}
