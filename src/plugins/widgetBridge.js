// BRI-29: Capacitor plugin wrapper for the native iOS WidgetBridge.
// The native side (ios/App/App/Plugins/WidgetBridge.swift) writes the
// snapshot JSON into App Group UserDefaults and triggers
// WidgetCenter.reloadAllTimelines(). On web (or any non-native runtime),
// calls here silently no-op — widgets aren't a thing on the web build.
//
// Mirrors the Capacitor.isNativePlatform() gate pattern from
// src/hooks/useNearestStop.js.

import { Capacitor, registerPlugin } from '@capacitor/core';

const WidgetBridge = registerPlugin('WidgetBridge');

// Each successful write triggers WidgetCenter.reloadAllTimelines() on the
// native side. iOS budgets ~40 reloads/hr per widget instance, so we dedupe
// on the *meaningful* portion of the payload — useFerryData.js naturally
// writes twice per refresh (realtime pass, then merged pass) and those
// first 3 departures are usually byte-identical even though the snapshot's
// `updatedAt` timestamp advances between passes. Dedupe excludes
// `updatedAt` for this reason; comparing full JSON would never match.
// `_lastSnapshotDedupKey` lives at module scope so it survives across hook
// re-renders; the React app is an SPA so there's only ever one module
// instance.
let _lastSnapshotDedupKey = null;

/**
 * Build the dedupe key for a snapshot — everything *except* `updatedAt`.
 * Two snapshots with the same stops + next departures should collapse into
 * a single native write even if their timestamps differ.
 */
function dedupKeyFor(snapshot) {
  const { updatedAt: _unused, ...rest } = snapshot;
  return JSON.stringify(rest);
}

/**
 * Write the widget snapshot JSON to shared App Group storage on iOS.
 *
 * Never throws. Failures are logged in dev mode and swallowed in prod so
 * widget-bridge issues can't break the main app. Payloads whose dedupe
 * key matches the previous successful write are skipped (see module
 * comment).
 *
 * @param {object} snapshot - Plain object from buildSnapshot(); will be JSON.stringify'd.
 * @returns {Promise<void>}
 */
export async function writeWidgetSnapshot(snapshot) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const dedupKey = dedupKeyFor(snapshot);
    if (dedupKey === _lastSnapshotDedupKey) return;

    await WidgetBridge.writeSnapshot({ json: JSON.stringify(snapshot) });
    _lastSnapshotDedupKey = dedupKey;
  } catch (err) {
    if (import.meta?.env?.DEV) {
      console.warn('[widgetBridge] writeSnapshot failed (ignored):', err);
    }
  }
}
