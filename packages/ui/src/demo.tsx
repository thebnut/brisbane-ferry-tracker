/**
 * Demo (fixture) mode on staging and in development (R7-B1). `?fixtures=1` switches it on where the Worker allows
 * it (ALLOW_FIXTURES), and a cookie keeps it across navigation, but only for an hour: a tester's profile must not
 * stay in demo mode into the next day's smoke test. `?fixtures=0` (the notices' "Exit demo" link) clears it.
 * Production never allows it (each app's wrangler-config test, and the Workers ignore the cookie there).
 */
import { useEffect } from 'react'
import { holdCacheLock } from './connectivity.ts'

/** How long one `?fixtures=1` keeps demo mode on. */
export const FIXTURE_COOKIE_MAX_AGE_S = 3600

/** The Set-Cookie-style string for document.cookie: on for an hour, or cleared. */
export function fixtureCookie(name: string, on: boolean): string {
  return on
    ? `${name}=1; path=/; max-age=${FIXTURE_COOKIE_MAX_AGE_S}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`
}

/** The apps' offline timetable copies (bus, train, transit Saved, ferry), kept per stop whatever the data mode. */
export const OFFLINE_COPY_PREFIXES = ['bft-bus-v1:', 'bft-train-offline:', 'bft-transit-v1:', 'bft-ferry-v1:']

/** A copy made from demo data, under any key: fixture responses and data files carry a `fixture-…` generation. */
export const FIXTURE_COPY = /"(?:staticGeneration|generation)":"fixture-/

/**
 * What the device held when this page started: its offline copies and copies made from demo data (key → value),
 * read during the first render, before any board writes one; and CACHE_WRITE_LOCK, asked for then too (null when it
 * wasn't granted: a write held it, or no Web Locks): while the clean-up holds it no cache write lands, so the caches it lists are what it began with.
 */
export interface DeviceStart {
  copies: ReadonlyMap<string, string>
  lock: Promise<(() => void) | null>
}

/** Set once the one-off clean-up of demo data stored before R7-B1 has run on this device (demo-cleanup.ts). */
export const DEMO_MIGRATION_KEY = 'bft-demo-cleanup'
export const DEMO_MIGRATION = 'r7'

let deviceStart: DeviceStart | undefined
/** Once per page, where the one-off clean-up hasn't run yet (R9, see DeviceStart). */
function noteDeviceStart(): DeviceStart | undefined {
  if (deviceStart) return deviceStart
  const copies = new Map<string, string>()
  try {
    if (localStorage.getItem(DEMO_MIGRATION_KEY) === DEMO_MIGRATION) return undefined
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key == null) continue
      const value = localStorage.getItem(key) ?? ''
      if (OFFLINE_COPY_PREFIXES.some((p) => key.startsWith(p)) || FIXTURE_COPY.test(value))
        copies.set(key, value)
    }
  } catch {
    // Storage blocked: nothing kept there, and no marker can be set either.
    return undefined
  }
  // A write in progress (another tab): no clean-up on this page, the next load tries again.
  const start: DeviceStart = { copies, lock: holdCacheLock('exclusive', true) }
  deviceStart = start
  // The clean-up runs from here, not from an effect: the lock is let go however it ends, even if this render never
  // commits (Codex review r4). Its code loads only when needed (precached, so offline too): first-load JS budget.
  void start.lock.then(
    (release) =>
      release &&
      import('./demo-cleanup.ts')
        .then((m) => m.migrateOnce(start))
        .catch(() => {})
        .finally(release),
  )
  return start
}

let demoSession = false
/**
 * Is this page in a visitor's demo session (?fixtures=1 and its cookie)? Then nothing it shows is kept on the device:
 * the apps' offline-copy writers skip their write, and the Workers mark its HTML and loader data (DEMO_HEADER) so no
 * cache keeps them. Demo data therefore never sits where real data lives (R7-B1, Codex review). FIXTURES=1 (forced,
 * development and tests) is not a session: its pages are all demo, and they keep copies as usual.
 */
export const isDemoSession = () => demoSession

/**
 * For each app's root (ferry: its boards): demo mode from the server's judgement of this page.
 *  - `active`: the server rendered this page in demo mode; `forced`: FIXTURES=1, demo for everyone (no session);
 *    `allowed`: this Worker allows demo mode at all (ALLOW_FIXTURES).
 *  - `?fixtures=1` on a demo page starts the cookie's hour; `?fixtures=0` ends it, drops any copy made from demo data
 *    and takes the parameter out of the URL (so a later reload is an ordinary visit).
 */
export function useFixtureCookie(name: string, active: boolean, forced = false, allowed = true): void {
  // During render, before any board below fetches and writes its copy.
  demoSession = active && !forced
  if (allowed && !forced && typeof window !== 'undefined') void noteDeviceStart()
  useEffect(() => {
    if (forced) return
    const params = new URLSearchParams(location.search)
    const q = params.get('fixtures')
    if (q === '1' && active) {
      // biome-ignore lint/suspicious/noDocumentCookie: a short-lived developer switch; the Cookie Store API isn't in Safari.
      document.cookie = fixtureCookie(name, true)
    } else if (q === '0') {
      // biome-ignore lint/suspicious/noDocumentCookie: as above.
      document.cookie = fixtureCookie(name, false)
      void import('./demo-cleanup.ts').then((m) => m.leaveDemo())
      params.delete('fixtures')
      const search = params.toString()
      history.replaceState(
        history.state,
        '',
        `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
      )
    }
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
