// Ferry data-source flag (transit-architecture.md §7, Phase 2 prep).
//
// 'legacy' (the default everywhere) keeps today's path: GitHub schedule JSON +
// /api/gtfs-proxy. 'v1' reads departures and vehicles from the transit API's
// /v1 endpoints instead, falling back to the legacy path on any failure.
//
// Resolution order, first match wins:
//  1. `?dataSource=v1` or `?dataSource=legacy` in the URL (sticky for the tab via sessionStorage)
//  2. the sticky sessionStorage value from an earlier URL param
//  3. VITE_FERRY_DATA_SOURCE=v1 at build time
//  4. VITE_FERRY_V1_PERCENT (0-100, default 0): stable bucket from a random id in localStorage
//
// Rollback = unset the env vars. This module has no imports so it runs under
// plain Node for scripts/test.

export const DATA_SOURCES = { legacy: 'legacy', v1: 'v1' };

export const DATA_SOURCE_SESSION_KEY = 'brisbane-ferry-data-source';
export const ROLLOUT_ID_KEY = 'brisbane-ferry-rollout-id';

export const DEFAULT_TRANSIT_API_BASE = 'https://bft-api.brisbanetransit.workers.dev';

const safeGet = (storage, key) => {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
};

const safeSet = (storage, key, value) => {
  try {
    if (storage) storage.setItem(key, value);
  } catch {
    // Storage disabled (private mode, quota): the flag just isn't sticky.
  }
};

const isKnownSource = (value) => value === DATA_SOURCES.legacy || value === DATA_SOURCES.v1;

// FNV-1a, 32-bit. Stable across browsers, good enough to spread ids over 100 buckets.
export function bucketOf(id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export function parsePercent(raw) {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
}

const randomId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Pure resolver. `env` is import.meta.env (or a stand-in), `search` is
 * window.location.search, storages may be null.
 */
export function resolveDataSource({ search = '', env = {}, session = null, local = null } = {}) {
  const param = new URLSearchParams(search).get('dataSource');
  if (isKnownSource(param)) {
    safeSet(session, DATA_SOURCE_SESSION_KEY, param);
    return param;
  }

  const sticky = safeGet(session, DATA_SOURCE_SESSION_KEY);
  if (isKnownSource(sticky)) return sticky;

  if (env.VITE_FERRY_DATA_SOURCE === DATA_SOURCES.v1) return DATA_SOURCES.v1;

  const percent = parsePercent(env.VITE_FERRY_V1_PERCENT);
  // Only touch localStorage when a rollout is actually configured, so the
  // default (flag off) leaves storage exactly as before.
  if (percent > 0) {
    let id = safeGet(local, ROLLOUT_ID_KEY);
    if (!id) {
      id = randomId();
      safeSet(local, ROLLOUT_ID_KEY, id);
    }
    if (bucketOf(id) < percent) return DATA_SOURCES.v1;
  }

  return DATA_SOURCES.legacy;
}

export function resolveTransitApiBase(env = {}) {
  const base = env.VITE_TRANSIT_API_BASE || DEFAULT_TRANSIT_API_BASE;
  return base.replace(/\/+$/, '');
}

const viteEnv = () => import.meta.env ?? {};

let cachedSource = null;

// Resolved once per page load so a refresh cycle never flips source mid-session.
export function getFerryDataSource() {
  if (cachedSource) return cachedSource;
  if (typeof window === 'undefined') return DATA_SOURCES.legacy;
  const storage = (name) => {
    try {
      return window[name];
    } catch {
      return null;
    }
  };
  cachedSource = resolveDataSource({
    search: window.location.search,
    env: viteEnv(),
    session: storage('sessionStorage'),
    local: storage('localStorage'),
  });
  return cachedSource;
}

export function getTransitApiBase() {
  return resolveTransitApiBase(viteEnv());
}
