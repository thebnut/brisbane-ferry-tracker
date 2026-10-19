import { useEffect, useState } from 'react'

/**
 * Current time that ticks every `intervalMs`. Starts at `initialMs` (the server's render time) so hydration matches
 * the server HTML, then switches to the device clock after mount.
 */
export function useNow(initialMs: number, intervalMs: number): number {
  const [now, setNow] = useState(initialMs)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Online as state (true during SSR): navigator.onLine plus whether API calls reach the network (@bft/ui). */
export { useOnline } from '@bft/ui/connectivity'
