//
//  WidgetSnapshot.swift
//  BrisbaneFerryWidget
//
//  Typed Swift models for the JSON snapshot the main app writes to App
//  Group UserDefaults. The JS side is in `src/services/widgetSnapshot.js`
//  — keep these two files in lock-step; bump the `v` suffix on any
//  breaking change to force a placeholder render until the app re-writes.
//

import Foundation

// MARK: - Models

struct WidgetSnapshot: Codable {
    /// Schema version. Bumped only on breaking changes — additive optional
    /// fields don't require a bump. Loader rejects snapshots whose `v`
    /// doesn't match `currentSchemaVersion` below.
    ///
    /// INVARIANT: when you bump this, also bump the UserDefaults key suffix
    /// in `WidgetSnapshotLoader.snapshotKey` and in the WidgetBridge plugin
    /// (ios/App/App/Plugins/WidgetBridge.swift). The versioned key lets old
    /// and new writers coexist during upgrade; the `v` field lets the
    /// reader fail fast on a schema mismatch. Keep the two in lock-step.
    static let currentSchemaVersion = 1

    let v: Int
    let updatedAt: Date
    let outbound: Direction
    /// Optional in v1: the JS side currently omits this because the widget
    /// doesn't render it. Left in the model so adding inbound later is a
    /// non-breaking change.
    let inbound: Direction?

    struct Direction: Codable {
        let originName: String
        let destName: String
        let departures: [Departure]
    }

    struct Departure: Codable, Identifiable {
        /// Stable id for SwiftUI's `ForEach`. Prefer `tripId` (survives delay
        /// changes that shift `t` between snapshots); fall back to a
        /// route@time composite only when tripId is absent (shouldn't happen
        /// with current writers but keeps us robust to older snapshots).
        var id: String { tripId ?? "\(route ?? "?")@\(t.timeIntervalSince1970)" }

        let tripId: String?
        let t: Date
        let scheduledT: Date?
        let arrivalT: Date?
        let route: String?
        let live: Bool?
        let delaySec: Int?

        var isLive: Bool { live == true }

        /// Maps raw route id (F1/F11) to a short human label.
        var routeLabel: String {
            switch route {
            case "F11": return "Express"
            case "F1":  return "All stops"
            default:    return "Ferry"
            }
        }

        /// Minutes until departure from a reference time. Negative if already gone.
        func minutesUntil(_ now: Date) -> Int {
            Int((t.timeIntervalSince(now) / 60.0).rounded())
        }
    }
}

// MARK: - Loader

enum WidgetSnapshotLoader {
    /// Shared App Group identifier — must match the App target's entitlement
    /// and the WidgetBridge plugin's write target.
    static let appGroupId = "group.com.brisbanetransport.ferry"

    /// UserDefaults key for the snapshot. Versioned.
    static let snapshotKey = "widget.snapshot.v1"

    /// Returns the decoded snapshot, or `nil` if:
    /// - the App Group can't be opened
    /// - no snapshot has been written yet (fresh install, app never opened)
    /// - JSON decoding fails (missing required field, bad date format, etc.)
    /// - the snapshot's schema version doesn't match the widget's expected version
    ///
    /// Decoding errors are logged in DEBUG builds so schema drift surfaces
    /// during development instead of silently rendering the placeholder.
    static func load() -> WidgetSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroupId),
              let raw = defaults.string(forKey: snapshotKey),
              let data = raw.data(using: .utf8)
        else { return nil }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601withFractionalSeconds

        do {
            let snapshot = try decoder.decode(WidgetSnapshot.self, from: data)
            guard snapshot.v == WidgetSnapshot.currentSchemaVersion else {
                #if DEBUG
                print("[WidgetSnapshotLoader] ignoring snapshot v=\(snapshot.v); widget expects v=\(WidgetSnapshot.currentSchemaVersion)")
                #endif
                return nil
            }
            return snapshot
        } catch {
            #if DEBUG
            print("[WidgetSnapshotLoader] decode failed: \(error)")
            #endif
            return nil
        }
    }
}

// MARK: - Date helpers

private extension JSONDecoder.DateDecodingStrategy {
    /// ISO-8601 with optional fractional seconds — matches what JS's
    /// `Date.prototype.toISOString()` produces (always has `.000` suffix
    /// for ms) and also handles non-fractional timestamps defensively.
    static var iso8601withFractionalSeconds: JSONDecoder.DateDecodingStrategy {
        .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)

            let withFractional = ISO8601DateFormatter()
            withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let d = withFractional.date(from: string) { return d }

            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let d = plain.date(from: string) { return d }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO-8601 date: \(string)"
            )
        }
    }
}

// MARK: - Preview / placeholder fixture

extension WidgetSnapshot {
    /// Hand-crafted sample used by `#Preview` macros and the TimelineProvider
    /// placeholder so previews render without touching UserDefaults.
    /// Intentionally available in Release too — it's ~50 bytes of Swift and
    /// lets the placeholder fallback show realistic data in the widget
    /// gallery before a real snapshot exists.
    static let sample: WidgetSnapshot = {
        let now = Date()
        func depart(_ mins: Double, live: Bool, route: String, delay: Int? = nil, tripId: String) -> Departure {
            Departure(
                tripId: tripId,
                t: now.addingTimeInterval(mins * 60),
                scheduledT: now.addingTimeInterval((mins + 1) * 60),
                arrivalT: now.addingTimeInterval((mins + 18) * 60),
                route: route,
                live: live,
                delaySec: delay
            )
        }
        return WidgetSnapshot(
            v: currentSchemaVersion,
            updatedAt: now.addingTimeInterval(-120),
            outbound: .init(
                originName: "Bulimba",
                destName: "Riverside",
                departures: [
                    depart(3,  live: true,  route: "F11", delay: -60,  tripId: "sample-1"),
                    depart(17, live: false, route: "F1",                tripId: "sample-2"),
                    depart(31, live: true,  route: "F11", delay: 120,  tripId: "sample-3")
                ]
            ),
            inbound: nil
        )
    }()
}
