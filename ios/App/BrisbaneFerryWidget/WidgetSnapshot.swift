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
    let v: Int
    let updatedAt: Date
    let outbound: Direction
    let inbound: Direction

    struct Direction: Codable {
        let originName: String
        let destName: String
        let departures: [Departure]
    }

    struct Departure: Codable, Identifiable {
        /// Composite id — departure time is unique enough within a 5-min window
        /// that we don't need to persist tripId. SwiftUI's `ForEach` needs this.
        var id: String { "\(route ?? "?")@\(t.timeIntervalSince1970)" }

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
    /// - JSON decoding fails (version mismatch, corruption, etc.)
    static func load() -> WidgetSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroupId),
              let raw = defaults.string(forKey: snapshotKey),
              let data = raw.data(using: .utf8)
        else { return nil }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601withFractionalSeconds
        return try? decoder.decode(WidgetSnapshot.self, from: data)
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
        func depart(_ mins: Double, live: Bool, route: String, delay: Int? = nil) -> Departure {
            Departure(
                t: now.addingTimeInterval(mins * 60),
                scheduledT: now.addingTimeInterval((mins + 1) * 60),
                arrivalT: now.addingTimeInterval((mins + 18) * 60),
                route: route,
                live: live,
                delaySec: delay
            )
        }
        return WidgetSnapshot(
            v: 1,
            updatedAt: now.addingTimeInterval(-120),
            outbound: .init(
                originName: "Bulimba",
                destName: "Riverside",
                departures: [
                    depart(3, live: true, route: "F11", delay: -60),
                    depart(17, live: false, route: "F1"),
                    depart(31, live: true, route: "F11", delay: 120)
                ]
            ),
            inbound: .init(
                originName: "Riverside",
                destName: "Bulimba",
                departures: [
                    depart(7, live: true, route: "F1"),
                    depart(24, live: false, route: "F11"),
                    depart(42, live: true, route: "F1", delay: 30)
                ]
            )
        )
    }()
}
