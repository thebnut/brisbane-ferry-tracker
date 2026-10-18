import { useEffect, useState } from 'react'

/**
 * Current time that ticks every `intervalMs`. Starts at `initialMs` (the server's render time) so hydration matches
 * the server HTML, then switches to the device clock after mount.
 */
export function useNow(initialMs: number, intervalMs = 15_000): number {
  const [now, setNow] = useState(initialMs)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** navigator.onLine as state (true during SSR). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
