/**
 * Demo (fixture) mode on staging and in development (R7-B1). `?fixtures=1` switches it on where the Worker allows
 * it (ALLOW_FIXTURES), and a cookie keeps it across navigation, but only for an hour: a tester's profile must not
 * stay in demo mode into the next day's smoke test. `?fixtures=0` (the notices' "Exit demo" link) clears it.
 * Production never allows it (each app's wrangler-config test, and the Workers ignore the cookie there).
 */
import { useEffect } from 'react'

/** How long one `?fixtures=1` keeps demo mode on. */
export const FIXTURE_COOKIE_MAX_AGE_S = 3600

/** The Set-Cookie-style string for document.cookie: on for an hour, or cleared. */
export function fixtureCookie(name: string, on: boolean): string {
  return on
    ? `${name}=1; path=/; max-age=${FIXTURE_COOKIE_MAX_AGE_S}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`
}

/** A copy made from demo data: fixture responses and data files carry a `fixture-…` generation. */
const FIXTURE_COPY = /"(?:staticGeneration|generation)":"fixture-/

/**
 * Demo data left on the device after demo mode (Codex review of R7-B1): the apps' offline timetable copies in
 * localStorage are kept per stop whatever the data mode, and the service worker's page, route-data and live caches
 * hold demo answers under ordinary URLs, so an offline reload or a slow network could bring "Demo data" back. Removes
 * every localStorage value made from demo data and, when any was found (or `force`), every runtime cache (the
 * precached app shell stays; the caches refill from the network). Returns how many stored copies were removed.
 */
export async function clearDemoLeftovers(
  { force = false }: { force?: boolean } = {},
  storage: Storage = localStorage,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
): Promise<number> {
  const stale: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key != null && FIXTURE_COPY.test(storage.getItem(key) ?? '')) stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
  } catch {
    // Storage blocked: nothing kept there either.
  }
  if ((force || stale.length) && cacheStorage)
    await Promise.allSettled(
      (await cacheStorage.keys())
        .filter((name) => !name.startsWith('workbox-precache'))
        .map((name) => cacheStorage.delete(name)),
    )
  return stale.length
}

/**
 * For each app's root: keeps the demo cookie in step with the URL. `?fixtures=1` (when the server put this page in
 * demo mode) starts the hour; `?fixtures=0` ends it at once and clears demo data off the device. Any page outside
 * demo mode also drops demo copies it finds (the hour ran out, or the exit link was never used).
 */
export function useFixtureCookie(name: string, active: boolean): void {
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('fixtures')
    // biome-ignore lint/suspicious/noDocumentCookie: a short-lived developer switch; the Cookie Store API isn't in Safari.
    if (q === '1' && active) document.cookie = fixtureCookie(name, true)
    else if (q === '0') {
      // biome-ignore lint/suspicious/noDocumentCookie: as above.
      document.cookie = fixtureCookie(name, false)
      void clearDemoLeftovers({ force: true })
    } else if (!active) void clearDemoLeftovers()
  }, [name, active])
}

/** "Exit demo": this page with `?fixtures=0`, a full load so the server renders it with real data. */
export function DemoExitLink({ className }: { className?: string }) {
  return (
    <a href="?fixtures=0" data-demo-exit="" className={className ?? 'font-semibold underline'}>
      Exit demo
    </a>
  )
}
