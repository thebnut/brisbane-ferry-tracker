//
//  WidgetBridge.swift
//  Brisbane Ferry
//
//  BRI-29: Capacitor plugin that writes the widget snapshot JSON into
//  App Group UserDefaults, then asks WidgetCenter to reload every
//  Brisbane Ferry widget instance on the home screen. The WidgetKit
//  extension (BrisbaneFerryWidget target) reads the same UserDefaults
//  key on its next timeline refresh.
//
//  The App Group `group.com.brisbanetransport.ferry` must be enabled
//  as a capability on BOTH the App target (for writes) and the
//  BrisbaneFerryWidget target (for reads).
//
//  Registration: Capacitor 8+ discovers plugins via the CAPBridgedPlugin
//  Swift protocol — no .m file or CAP_PLUGIN macro required (that
//  pattern is Capacitor 4/5-era).
//

import Foundation
import Capacitor

#if canImport(WidgetKit)
import WidgetKit
#endif

@objc(WidgetBridge)
public class WidgetBridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridge"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise)
    ]

    /// Shared App Group identifier. Must match:
    /// - `group.com.brisbanetransport.ferry` in the App target's entitlements
    /// - the `App Groups` capability on the Widget target
    /// - the suiteName used by the widget's SnapshotLoader
    private static let appGroupId = "group.com.brisbanetransport.ferry"

    /// UserDefaults key for the snapshot blob. Versioned — bump the suffix
    /// on any breaking change to the JSON schema; widget falls back to its
    /// placeholder view on an unknown version.
    private static let snapshotKey = "widget.snapshot.v1"

    /// Capacitor entry point: `WidgetBridge.writeSnapshot({ json: "<string>" })`.
    /// The JS side passes an already-stringified JSON blob; we store it as-is
    /// so the widget can decode it without re-encoding surprises.
    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), !json.isEmpty else {
            call.reject("writeSnapshot: missing or empty `json` argument")
            return
        }

        guard let defaults = UserDefaults(suiteName: Self.appGroupId) else {
            call.reject("writeSnapshot: failed to open App Group UserDefaults for \(Self.appGroupId)")
            return
        }

        defaults.set(json, forKey: Self.snapshotKey)

        // Ask iOS to rebuild every Brisbane Ferry widget on the home screen.
        // iOS budgets ~40 reloads/hr per widget instance — well above our
        // natural cadence (app refreshes every 5 min).
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        #endif

        call.resolve([
            "bytes": json.utf8.count
        ])
    }
}
