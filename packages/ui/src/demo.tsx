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
 * The apps' offline timetable copies (bus, train, transit Saved, ferry). Kept per stop whatever the data mode, and
 * some (train's day copies) carry no generation, so leaving demo mode drops them all; they refill online.
 */
export const OFFLINE_COPY_PREFIXES = ['bft-bus-v1:', 'bft-train-offline:', 'bft-transit-v1:', 'bft-ferry-v1:']
/** Set while this device is in a visitor's demo session (?fixtures=1 and its hour-long cookie). */
export const DEMO_SESSION_KEY = 'bft-demo-session'

/**
 * Demo data left on the device after demo mode (Codex review of R7-B1): offline copies in localStorage and the
 * service worker's page, route-data and live caches hold demo answers under ordinary URLs, so an offline reload or a
 * slow network could bring "Demo data" back. With `all` (leaving a demo session) it drops every offline copy and every
 * runtime cache (the precached app shell stays; everything refills from the network); otherwise only values made from
 * demo data, and the runtime caches when any was found. Returns how many stored copies were removed.
 */
export async function clearDemoLeftovers(
  { all = false }: { all?: boolean } = {},
  storage: Storage = localStorage,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
): Promise<number> {
  const stale: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key == null) continue
      if (
        (all && (key === DEMO_SESSION_KEY || OFFLINE_COPY_PREFIXES.some((p) => key.startsWith(p)))) ||
        FIXTURE_COPY.test(storage.getItem(key) ?? '')
      )
        stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
  } catch {
    // Storage blocked: nothing kept there either.
  }
  if ((all || stale.length) && cacheStorage)
    await Promise.allSettled(
      (await cacheStorage.keys())
        .filter((name) => !name.startsWith('workbox-precache'))
        .map((name) => cacheStorage.delete(name)),
    )
  return stale.length
}

const readCookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null
const inDemoSession = () => {
  try {
    return localStorage.getItem(DEMO_SESSION_KEY) != null
  } catch {
    return false
  }
}

/**
 * For each app's root: keeps the demo cookie in step with the URL, and demo data off the device outside demo mode.
 *  - `?fixtures=1` (when the server put this page in demo mode) starts the hour and marks a demo session;
 *  - `?fixtures=0` ends it at once and clears demo data off the device;
 *  - a page outside demo mode ends a demo session the same way (the hour ran out), and drops any copy made from demo
 *    data it finds;
 *  - a demo page with neither the parameter nor the cookie is an old copy from the service worker (its session is
 *    over): demo data is cleared and the page loads again from the network (or the offline page).
 * `forced` (FIXTURES=1, development and tests) is demo mode for everyone: nothing to start or end.
 */
export function useFixtureCookie(name: string, active: boolean, forced = false): void {
  useEffect(() => {
    if (forced) return
    const q = new URLSearchParams(location.search).get('fixtures')
    const mark = () => {
      try {
        localStorage.setItem(DEMO_SESSION_KEY, String(Date.now()))
      } catch {
        // Storage blocked: the cookie's hour still ends it.
      }
    }
    if (q === '0') {
      // biome-ignore lint/suspicious/noDocumentCookie: a short-lived developer switch; the Cookie Store API isn't in Safari.
      document.cookie = fixtureCookie(name, false)
      void clearDemoLeftovers({ all: true })
    } else if (active && q === '1') {
      // biome-ignore lint/suspicious/noDocumentCookie: as above.
      document.cookie = fixtureCookie(name, true)
      mark()
    } else if (active && readCookie(name) === '1') mark()
    else if (active) void clearDemoLeftovers({ all: true }).then(() => location.reload())
    else void clearDemoLeftovers({ all: inDemoSession() })
  }, [name, active, forced])
}

/** "Exit demo": this page with `?fixtures=0`, a full load so the server renders it with real data. */
export function DemoExitLink({ className }: { className?: string }) {
  return (
    <a href="?fixtures=0" data-demo-exit="" className={className ?? 'font-semibold underline'}>
      Exit demo
    </a>
  )
}
