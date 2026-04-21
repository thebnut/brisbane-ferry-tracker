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

/**
 * Write the widget snapshot JSON to shared App Group storage on iOS.
 *
 * Never throws. Failures are logged in dev mode and swallowed in prod so
 * widget-bridge issues can't break the main app.
 *
 * @param {object} snapshot - Plain object from buildSnapshot(); will be JSON.stringify'd.
 * @returns {Promise<void>}
 */
export async function writeWidgetSnapshot(snapshot) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const json = JSON.stringify(snapshot);
    await WidgetBridge.writeSnapshot({ json });
  } catch (err) {
    if (import.meta?.env?.DEV) {
      console.warn('[widgetBridge] writeSnapshot failed (ignored):', err);
    }
  }
}
