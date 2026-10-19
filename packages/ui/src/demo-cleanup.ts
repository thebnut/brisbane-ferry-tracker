/** Removing demo data from the device (R7-B1); loaded on demand by demo.tsx. */
/** Set once the one-off clean-up of demo data stored before R7-B1 has run on this device. */
export const DEMO_MIGRATION_KEY = 'bft-demo-cleanup'
const DEMO_MIGRATION = 'r7'
/** The apps' offline timetable copies (bus, train, transit Saved, ferry), kept per stop whatever the data mode. */
export const OFFLINE_COPY_PREFIXES = ['bft-bus-v1:', 'bft-train-offline:', 'bft-transit-v1:', 'bft-ferry-v1:']
/** A copy made from demo data: fixture responses and data files carry a `fixture-…` generation. */
const FIXTURE_COPY = /"(?:staticGeneration|generation)":"fixture-/
/**
 * Removes demo data from the device: every localStorage value made from demo data (a `fixture-…` generation) and,
 * when any was found or with `all`, the apps' offline copies and the runtime caches (the precached app shell stays;
 * everything refills from the network). Returns how many stored copies were removed.
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
        (all && OFFLINE_COPY_PREFIXES.some((p) => key.startsWith(p))) ||
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

/**
 * Where demo mode is allowed (staging, development), demo data stored before R7-B1 may still be on the device under
 * ordinary keys and URLs (train's day copies carry no generation): drop every offline copy and runtime cache once.
 * Production never allowed demo mode, so it has none and keeps its copies.
 */
export async function migrateOnce(): Promise<void> {
  try {
    if (localStorage.getItem(DEMO_MIGRATION_KEY) === DEMO_MIGRATION) return
    await clearDemoLeftovers({ all: true })
    localStorage.setItem(DEMO_MIGRATION_KEY, DEMO_MIGRATION)
  } catch {
    // Storage blocked: nothing kept there either.
  }
}
