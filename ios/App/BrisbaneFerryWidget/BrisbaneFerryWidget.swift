//
//  BrisbaneFerryWidget.swift
//  BrisbaneFerryWidget
//
//  Widget configuration for Brisbane Ferry. Uses a StaticConfiguration
//  (non-interactive; user doesn't pick route in the widget's long-press
//  config — that's tracked as a v2 feature in BRI-45). Reads the
//  snapshot written by the main app via WidgetBridge and renders the
//  next few departures for the user's saved outbound route.
//

import WidgetKit
import SwiftUI

struct BrisbaneFerryWidget: Widget {
    let kind: String = "BrisbaneFerryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DepartureTimelineProvider()) { entry in
            BrisbaneFerryWidgetEntryView(entry: entry)
                .modifier(WidgetBackgroundModifier())
        }
        .configurationDisplayName("Brisbane Ferry")
        .description("Next ferries on your saved route.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// Routes each WidgetFamily to the right SwiftUI view.
struct BrisbaneFerryWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DepartureEntry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallDepartureView(entry: entry)
        case .systemMedium:
            MediumDepartureView(entry: entry)
        default:
            // Large / accessory families aren't in v1 scope — show the
            // medium layout as a graceful fallback.
            MediumDepartureView(entry: entry)
        }
    }
}

/// iOS 17+ uses `.containerBackground(…for: .widget)` for the default
/// widget background (required for StandBy, Lock Screen layering, etc.);
/// earlier iOS falls back to a padded coloured background.
private struct WidgetBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(Theme.cream, for: .widget)
        } else {
            content.padding().background(Theme.cream)
        }
    }
}

// MARK: - Previews

#Preview("Medium", as: .systemMedium) {
    BrisbaneFerryWidget()
} timeline: {
    DepartureEntry(date: .now, snapshot: .sample)
    DepartureEntry(date: .now.addingTimeInterval(60), snapshot: .sample)
}

#Preview("Small", as: .systemSmall) {
    BrisbaneFerryWidget()
} timeline: {
    DepartureEntry(date: .now, snapshot: .sample)
}

#Preview("Placeholder", as: .systemMedium) {
    BrisbaneFerryWidget()
} timeline: {
    DepartureEntry(date: .now, snapshot: nil)
}
