import { type ReactNode, useEffect, useState } from 'react'

/**
 * Renders `fallback` on the server and during hydration, then `children` after mount. MapLibre is stubbed out of
 * the Worker bundle (vite.config.ts), so a map rendered during SSR would hydrate against different markup.
 */
export function ClientOnly({ children, fallback }: { children: () => ReactNode; fallback: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return <>{mounted ? children() : fallback}</>
}
