/** Removing demo data from the device (R7-B1); loaded on demand by demo.tsx. */
import { holdCacheLock, RESAVE_PAGES } from './connectivity.ts'
import {
  DEMO_MIGRATION,
  DEMO_MIGRATION_KEY,
  type DeviceStart,
  FIXTURE_COPY,
  OFFLINE_COPY_PREFIXES,
} from './demo.tsx'

export { DEMO_MIGRATION_KEY }

/** How long the one-off clean-up may hold back cache writers (the service worker's install waits up to 10 s). */
export const CLEANUP_MAX_MS = 5_000

/** The clean-up's time is up: it stops before its next step, and is not marked done (the next load tries again). */
export class CleanupTimedOut extends Error {}

/**
 * After cached responses were removed: ask this origin's service workers to save their install-time pages and this
 * page again (R9: the page cache may have held what a worker saved at install, or this page's own copy).
 */
export async function askWorkersToResave(
  container: ServiceWorkerContainer | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.serviceWorker,
): Promise<void> {
  const reg = await container?.getRegistration().catch(() => undefined)
  for (const worker of new Set([reg?.installing, reg?.waiting, reg?.active]))
    worker?.postMessage({ type: RESAVE_PAGES })
}

/**
 * Removes demo data from the device: every localStorage value made from demo data (a `fixture-…` generation) and,
 * when any was found or with `all`, the apps' offline copies and every runtime cache's entries (the precached app
 * shell stays; everything refills from the network, and the service workers re-save their pages). Returns how many
 * stored copies were removed.
 *
 * The caller holds CACHE_WRITE_LOCK exclusively, so the entries listed here are all there is until it lets go. With
 * `start`, `all` removes only the offline copies that still hold their value from the page's first render (a board
 * may have written its copy since: localStorage writers don't take the lock). Past `deadline` it stops before its
 * next step (CleanupTimedOut).
 */
export async function clearDemoLeftovers(
  {
    all = false,
    start,
    deadline = Number.POSITIVE_INFINITY,
  }: { all?: boolean; start?: Pick<DeviceStart, 'copies'>; deadline?: number } = {},
  storage: Storage = localStorage,
  // null: leave Cache Storage alone.
  cacheStorage: CacheStorage | null | undefined = typeof caches === 'undefined' ? undefined : caches,
  resave: () => Promise<void> = askWorkersToResave,
  now: () => number = Date.now,
): Promise<number> {
  const stale: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key == null) continue
      const value = storage.getItem(key) ?? ''
      if (
        FIXTURE_COPY.test(value) ||
        (all &&
          OFFLINE_COPY_PREFIXES.some((p) => key.startsWith(p)) &&
          (!start || start.copies.get(key) === value))
      )
        stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
  } catch {
    // Storage blocked: nothing kept there either.
  }
  if ((all || stale.length) && cacheStorage) {
    const step = () => {
      if (now() > deadline) throw new CleanupTimedOut()
    }
    let removed = false
    try {
      for (const name of await cacheStorage.keys()) {
        if (name.startsWith('workbox-precache')) continue
        step()
        const cache = await cacheStorage.open(name)
        for (const req of await cache.keys()) {
          step()
          if (await cache.delete(req)) removed = true
        }
      }
    } finally {
      if (removed) await resave().catch(() => {})
    }
  }
  return stale.length
}

/**
 * `?fixtures=0`: drop what demo mode left, holding back cache writers meanwhile. Without the lock (no Web Locks) only
 * the localStorage copies go: Cache Storage is left alone rather than raced.
 */
export async function leaveDemo(): Promise<void> {
  const release = await holdCacheLock('exclusive')
  try {
    await clearDemoLeftovers(
      { deadline: Date.now() + CLEANUP_MAX_MS },
      localStorage,
      release ? undefined : null,
    )
  } catch {
    // Timed out: whatever is left is removed on the next `?fixtures=0`.
  } finally {
    release?.()
  }
}

/**
 * Where demo mode is allowed (staging, development), demo data stored before R7-B1 may still be on the device under
 * ordinary keys and URLs (train's day copies carry no generation): once, drop every offline copy the page started
 * with and every cached response. The page asked for CACHE_WRITE_LOCK during its first render, before the service
 * worker registers or the page saves its copy, and holds it until this has settled: so a fresh device (site data just
 * cleared) finds nothing and only records that the clean-up is done, and nothing saved after the clean-up began is
 * removed (R9). Production never allowed demo mode, so it has none and keeps its copies.
 */
export async function migrateOnce(start: DeviceStart, maxMs = CLEANUP_MAX_MS, now: () => number = Date.now) {
  try {
    if (localStorage.getItem(DEMO_MIGRATION_KEY) === DEMO_MIGRATION) return
    // Not granted (a write was in progress when the page started, or no Web Locks here): not done, and nothing is
    // removed; the next load tries again.
    if (!(await start.lock)) return
    await clearDemoLeftovers(
      { all: true, start, deadline: now() + maxMs },
      localStorage,
      typeof caches === 'undefined' ? undefined : caches,
      askWorkersToResave,
      now,
    )
    localStorage.setItem(DEMO_MIGRATION_KEY, DEMO_MIGRATION)
  } catch {
    // Storage blocked, or timed out (CleanupTimedOut): not marked done.
  }
}
