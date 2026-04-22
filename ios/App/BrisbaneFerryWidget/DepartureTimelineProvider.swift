//
//  DepartureTimelineProvider.swift
//  BrisbaneFerryWidget
//
//  Decides WHEN WidgetKit should re-render the widget. Strategy:
//  - Placeholder while the home screen is scrolling / Widget gallery shows previews
//  - One entry per upcoming departure so the countdown ticks down naturally
//  - Fallback refresh after 15 min idle, even if no departure crossed by then
//  - App-triggered reload via `WidgetCenter.reloadAllTimelines()` from the
//    Capacitor plugin on every data refresh — so opening the app is the
//    fastest path to fresh data. System budgets ~40 reloads/hr per widget,
//    well above our natural cadence.
//

import Foundation
import WidgetKit

struct DepartureEntry: TimelineEntry {
    /// `Date` is the reference time WidgetKit uses to render this entry;
    /// our countdown views compute "in X min" relative to this, not the
    /// wall clock, so entries render deterministically as the timeline advances.
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct DepartureTimelineProvider: TimelineProvider {

    /// Shown in the widget gallery and while content loads. Must render
    /// quickly and without touching UserDefaults or performing I/O.
    func placeholder(in context: Context) -> DepartureEntry {
        #if DEBUG
        return DepartureEntry(date: Date(), snapshot: .sample)
        #else
        return DepartureEntry(date: Date(), snapshot: nil)
        #endif
    }

    /// Shown as the preview in the Add Widget gallery — uses the most
    /// recent real data if present, otherwise the placeholder.
    func getSnapshot(in context: Context, completion: @escaping (DepartureEntry) -> Void) {
        let entry = DepartureEntry(date: Date(), snapshot: WidgetSnapshotLoader.load())
        completion(entry)
    }

    /// Builds the actual timeline of entries that WidgetKit will render
    /// over the next ~15 minutes. One entry per upcoming departure keeps
    /// the countdown honest without per-second refreshes.
    func getTimeline(in context: Context, completion: @escaping (Timeline<DepartureEntry>) -> Void) {
        let now = Date()
        let snapshot = WidgetSnapshotLoader.load()

        // Seed with the current moment; SwiftUI interpolates the countdown
        // smoothly between this entry and the next.
        var entries: [DepartureEntry] = [DepartureEntry(date: now, snapshot: snapshot)]

        // Add one entry at each upcoming outbound departure so the "in 3 min"
        // label and LIVE badge refresh at the right moments. Cap at 6 entries
        // (~30 min horizon) to stay well within system limits.
        if let snapshot {
            let upcoming = snapshot.outbound.departures
                .map(\.t)
                .filter { $0 > now }
                .prefix(5)
            for date in upcoming {
                entries.append(DepartureEntry(date: date, snapshot: snapshot))
            }
        }

        // 15-min ceiling: even if no departures fire before then, we want
        // a wall-clock refresh so staleness updates and new data lands.
        let ceiling = now.addingTimeInterval(15 * 60)
        let refreshAt = min(entries.last?.date.addingTimeInterval(60) ?? ceiling, ceiling)

        let timeline = Timeline(entries: entries, policy: .after(refreshAt))
        completion(timeline)
    }
}
