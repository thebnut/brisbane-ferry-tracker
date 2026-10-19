/** Removing demo data from the device (R7-B1); loaded on demand by demo.tsx. */
import { RESAVE_PAGES } from './connectivity.ts'
import { type DeviceStart, FIXTURE_COPY, OFFLINE_COPY_PREFIXES, responseStamp } from './demo.tsx'

/** Set once the one-off clean-up of demo data stored before R7-B1 has run on this device. */
export const DEMO_MIGRATION_KEY = 'bft-demo-cleanup'
const DEMO_MIGRATION = 'r7'

/** The runtime caches among cache names (the precached app shell is never removed). */
const runtimeCacheNames = (names: readonly string[]) => names.filter((n) => !n.startsWith('workbox-precache'))

/**
 * After runtime caches were dropped: ask this origin's service workers to save their install-time pages and this
 * page again (R9: the dropped page cache may have held what a worker saved at install, or this page's own copy).
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
 * when any was found or with `all`, the apps' offline copies and the runtime caches (the precached app shell stays;
 * everything refills from the network, and the service workers re-save their pages). Returns how many stored copies
 * were removed.
 *
 * With `start` (what the device held when the page started), `all` removes only that: an offline copy still holding
 * its value from then, and a cache entry still holding the response from then. Whatever this visit, another tab or a
 * service worker saved since stays, in caches that existed then too (R9: the one-off clean-up used to delete the home
 * a new worker had just saved at install). Demo data is removed wherever it is.
 */
export async function clearDemoLeftovers(
  { all = false, start }: { all?: boolean; start?: DeviceStart } = {},
  storage: Storage = localStorage,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
  resave: () => Promise<void> = askWorkersToResave,
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
    const removed = start
      ? await removeHeldEntries(start.caches, cacheStorage)
      : (
          await Promise.allSettled(
            runtimeCacheNames(await cacheStorage.keys()).map((name) => cacheStorage.delete(name)),
          )
        ).some((d) => d.status === 'fulfilled' && d.value)
    if (removed) await resave().catch(() => {})
  }
  return stale.length
}

/** Deletes each entry the page started with that still holds the same response. Whether any was deleted. */
async function removeHeldEntries(held: DeviceStart['caches'], cacheStorage: CacheStorage): Promise<boolean> {
  let removed = false
  for (const [name, entries] of held) {
    if (name.startsWith('workbox-precache') || !(await cacheStorage.has(name))) continue
    const cache = await cacheStorage.open(name)
    for (const [url, stamp] of entries) {
      const res = await cache.match(url)
      if (res && responseStamp(res) === stamp && (await cache.delete(url))) removed = true
    }
  }
  return removed
}

/**
 * Where demo mode is allowed (staging, development), demo data stored before R7-B1 may still be on the device under
 * ordinary keys and URLs (train's day copies carry no generation): drop every offline copy and cached response the
 * device held when this page started, once. A device that held none (a fresh profile, or site data just cleared)
 * has nothing from before R7-B1: it only records that the clean-up is done. Production never allowed demo mode, so
 * it has none and keeps its copies.
 */
export async function migrateOnce(start: Promise<DeviceStart>): Promise<void> {
  try {
    if (localStorage.getItem(DEMO_MIGRATION_KEY) === DEMO_MIGRATION) return
    const held = await start
    if (held.copies.size || held.caches.size) await clearDemoLeftovers({ all: true, start: held })
    localStorage.setItem(DEMO_MIGRATION_KEY, DEMO_MIGRATION)
  } catch {
    // Storage blocked: nothing kept there either.
  }
}
