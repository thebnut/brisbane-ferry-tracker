// Best-effort in-memory per-key rate limiter for the legacy Vercel routes.
//
// Limits (by design, documented in the feedback PR):
// - State lives in one function instance. Vercel runs several instances and
//   recycles them, so a client can get up to `limit` requests per window from
//   each warm instance, and a cold start forgets everything. It slows casual
//   abuse; it is not a guarantee.
// - Memory is bounded by `maxKeys`: past that, expired keys are dropped first,
//   then the oldest-seen keys.
// The robust option is a Vercel Firewall rate-limit rule on /api/feedback.

/**
 * @param {{ limit: number, windowMs: number, maxKeys?: number, now?: () => number }} opts
 * @returns {{ check: (key: string) => boolean, size: () => number }}
 */
export function createMemoryRateLimiter({ limit, windowMs, maxKeys = 5000, now = Date.now }) {
  /** @type {Map<string, number[]>} key → request times inside the window, oldest first */
  const hits = new Map();

  function evict(t) {
    for (const [k, times] of hits) {
      if (times[times.length - 1] <= t - windowMs) hits.delete(k);
    }
    while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
  }

  return {
    /** true when the request is allowed (and counted), false when over the limit */
    check(key) {
      const t = now();
      const times = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
      if (times.length >= limit) {
        hits.set(key, times);
        return false;
      }
      times.push(t);
      if (!hits.has(key) && hits.size >= maxKeys) evict(t);
      hits.delete(key); // re-insert so Map order tracks the most recent use
      hits.set(key, times);
      return true;
    },
    size: () => hits.size,
  };
}
