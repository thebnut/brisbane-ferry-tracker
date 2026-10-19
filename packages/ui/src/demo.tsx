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

/** Identifies one stored response: a copy saved again later has another `date` (the Workers' responses carry one). */
export const responseStamp = (res: Response) =>
  ['date', 'etag', 'content-length'].map((h) => res.headers.get(h) ?? '').join('|')

/**
 * What the device held when this page started: its offline copies and copies made from demo data (key → value),
 * and each runtime cache's entries (cache name → URL → responseStamp).
 */
export interface DeviceStart {
  copies: ReadonlyMap<string, string>
  caches: ReadonlyMap<string, ReadonlyMap<string, string>>
}

async function cacheEntries(): Promise<DeviceStart['caches']> {
  const held = new Map<string, Map<string, string>>()
  if (typeof caches === 'undefined') return held
  for (const name of await caches.keys()) {
    if (name.startsWith('workbox-precache')) continue
    const cache = await caches.open(name)
    const entries = new Map<string, string>()
    for (const req of await cache.keys()) {
      const res = await cache.match(req)
      if (res) entries.set(req.url, responseStamp(res))
    }
    held.set(name, entries)
  }
  return held
}

/** Set once the one-off clean-up of demo data stored before R7-B1 has run on this device (demo-cleanup.ts). */
export const DEMO_MIGRATION_KEY = 'bft-demo-cleanup'
export const DEMO_MIGRATION = 'r7'
/** The longest the clean-up holds back cache writers (the service worker's install waits up to 10 s for its saves). */
const CLEANUP_MAX_MS = 5_000

let deviceStart: Promise<DeviceStart> | undefined
let endCleanup = () => {}
let cleanupStarted = false
/**
 * Where the one-off clean-up hasn't run yet: notes what the device holds, once per page and before anything on it is
 * saved, and holds back every cache writer (CACHE_WRITE_LOCK) until the clean-up has finished, so it can only ever
 * remove what was there when it began (R9). The offline copies are read during the first render, before any board
 * writes one; the caches once the lock is granted, so no writer can interleave with the listing or the deletions.
 */
function noteDeviceStart(): Promise<DeviceStart> | undefined {
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
  deviceStart = holdCacheLock('exclusive', CLEANUP_MAX_MS)
    .then(async (release) => {
      endCleanup = release
      return cacheEntries()
    })
    .catch(() => new Map())
    .then((c) => ({ copies, caches: c }))
  return deviceStart
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
    // The clean-up code loads only when needed (it is precached, so offline too): first-load JS budget. Once per page
    // (StrictMode runs effects twice), and the writers are let go however it ends.
    const start = allowed ? deviceStart : undefined
    if (start && !cleanupStarted) {
      cleanupStarted = true
      void import('./demo-cleanup.ts')
        .then((m) => m.migrateOnce(start))
        .catch(() => {})
        .finally(() => endCleanup())
    }
    const params = new URLSearchParams(location.search)
    const q = params.get('fixtures')
    if (q === '1' && active) {
      // biome-ignore lint/suspicious/noDocumentCookie: a short-lived developer switch; the Cookie Store API isn't in Safari.
      document.cookie = fixtureCookie(name, true)
    } else if (q === '0') {
      // biome-ignore lint/suspicious/noDocumentCookie: as above.
      document.cookie = fixtureCookie(name, false)
      void import('./demo-cleanup.ts').then((m) => m.clearDemoLeftovers())
      params.delete('fixtures')
      const search = params.toString()
      history.replaceState(
        history.state,
        '',
        `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
      )
    }
  }, [name, active, forced, allowed])
}

/** "Exit demo": this page with `?fixtures=0`, a full load so the server renders it with real data. */
export function DemoExitLink({ className }: { className?: string }) {
  return (
    <a href="?fixtures=0" data-demo-exit="" className={className ?? 'font-semibold underline'}>
      Exit demo
    </a>
  )
}
