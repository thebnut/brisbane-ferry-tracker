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

/** The apps' offline timetable copies (bus, train, transit Saved, ferry), kept per stop whatever the data mode. */
export const OFFLINE_COPY_PREFIXES = ['bft-bus-v1:', 'bft-train-offline:', 'bft-transit-v1:', 'bft-ferry-v1:']

/** What the device held when this page started: its offline copies (key → value) and Cache Storage names. */
export interface DeviceStart {
  copies: ReadonlyMap<string, string>
  caches: readonly string[]
}

let deviceStart: Promise<DeviceStart> | undefined
/**
 * Notes what the device holds, once per page and before anything on it is saved: the first render comes before any
 * board writes its copy, and before the service worker registers (after `load`) to save its pages. The one-off
 * clean-up removes only this (R9).
 */
function noteDeviceStart(): Promise<DeviceStart> {
  if (deviceStart) return deviceStart
  const copies = new Map<string, string>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key != null && OFFLINE_COPY_PREFIXES.some((p) => key.startsWith(p)))
        copies.set(key, localStorage.getItem(key) ?? '')
    }
  } catch {
    // Storage blocked: nothing kept there either.
  }
  const names = typeof caches === 'undefined' ? Promise.resolve([]) : caches.keys().catch(() => [])
  deviceStart = names.then((c) => ({ copies, caches: c }))
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
    // The clean-up code loads only when needed (it is precached, so offline too): first-load JS budget.
    if (allowed) void import('./demo-cleanup.ts').then((m) => m.migrateOnce(noteDeviceStart()))
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
