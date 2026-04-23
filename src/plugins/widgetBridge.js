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
// identical payloads — useFerryData.js naturally writes twice per refresh
// (realtime pass, then merged pass) and those first 3 departures are
// usually byte-identical. `_lastSnapshotJson` lives at module scope so it
// survives across hook re-renders; the React app is a single-page app so
// there's only ever one module instance.
let _lastSnapshotJson = null;

/**
 * Write the widget snapshot JSON to shared App Group storage on iOS.
 *
 * Never throws. Failures are logged in dev mode and swallowed in prod so
 * widget-bridge issues can't break the main app. Identical payloads to the
 * previous successful write are skipped (see module comment).
 *
 * @param {object} snapshot - Plain object from buildSnapshot(); will be JSON.stringify'd.
 * @returns {Promise<void>}
 */
export async function writeWidgetSnapshot(snapshot) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const json = JSON.stringify(snapshot);
    if (json === _lastSnapshotJson) return;

    await WidgetBridge.writeSnapshot({ json });
    _lastSnapshotJson = json;
  } catch (err) {
    if (import.meta?.env?.DEV) {
      console.warn('[widgetBridge] writeSnapshot failed (ignored):', err);
    }
  }
}
