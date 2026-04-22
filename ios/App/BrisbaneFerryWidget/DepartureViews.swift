//
//  DepartureViews.swift
//  BrisbaneFerryWidget
//
//  All SwiftUI views for the widget families. Laid out top-to-bottom:
//    - MediumDepartureView (4×2, v1 primary target)
//    - SmallDepartureView  (2×2, stretch goal)
//    - DepartureRow        (shared — countdown + clock + live badge)
//    - StalenessBadge      (shown when updatedAt is stale)
//    - PlaceholderView     (first-run / no-data)
//

import SwiftUI
import WidgetKit

// If the widget snapshot is older than this, show the staleness badge.
// Tuned to "~6 missed app refreshes" (app auto-refreshes every 5 min).
private let stalenessThreshold: TimeInterval = 30 * 60

// MARK: - Medium (4×2)

struct MediumDepartureView: View {
    let entry: DepartureEntry

    var body: some View {
        guard let snapshot = entry.snapshot else {
            return AnyView(PlaceholderView())
        }

        let dir = snapshot.outbound
        let upcoming = dir.departures
            .filter { $0.t > entry.date }
            .prefix(3)

        return AnyView(
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text(dir.originName)
                        .font(.caption).fontWeight(.semibold)
                        .foregroundStyle(Theme.charcoal)
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                    Text(dir.destName)
                        .font(.caption).fontWeight(.semibold)
                        .foregroundStyle(Theme.charcoal)
                    Spacer()
                    StalenessBadge(updatedAt: snapshot.updatedAt, now: entry.date)
                }

                if upcoming.isEmpty {
                    Spacer()
                    Text("No ferries for a while")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                    Spacer()
                } else {
                    ForEach(Array(upcoming)) { dep in
                        DepartureRow(departure: dep, now: entry.date)
                    }
                    Spacer(minLength: 0)
                }
            }
        )
    }
}

// MARK: - Small (2×2)

struct SmallDepartureView: View {
    let entry: DepartureEntry

    var body: some View {
        guard let snapshot = entry.snapshot,
              let next = snapshot.outbound.departures.first(where: { $0.t > entry.date })
        else {
            return AnyView(PlaceholderView())
        }

        return AnyView(
            VStack(alignment: .leading, spacing: 4) {
                Text("\(snapshot.outbound.originName) →")
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                Text(snapshot.outbound.destName)
                    .font(.caption).fontWeight(.semibold)
                    .foregroundStyle(Theme.charcoal)
                Spacer()
                Text(countdownText(minutes: next.minutesUntil(entry.date)))
                    .font(.system(.title3, design: .rounded).weight(.bold))
                    .foregroundStyle(Theme.charcoal)
                Text(next.t, style: .time)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                if next.isLive {
                    LiveBadge()
                }
            }
        )
    }
}

// MARK: - DepartureRow

struct DepartureRow: View {
    let departure: WidgetSnapshot.Departure
    let now: Date

    var body: some View {
        HStack(spacing: 6) {
            Text(departure.t, style: .time)
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .foregroundStyle(Theme.charcoal)
                .frame(width: 56, alignment: .leading)

            Text(countdownText(minutes: departure.minutesUntil(now)))
                .font(.caption2)
                .foregroundStyle(Theme.muted)

            Spacer()

            if departure.isLive {
                LiveBadge()
            }
        }
    }
}

// MARK: - Subviews

private struct LiveBadge: View {
    var body: some View {
        Text("LIVE")
            .font(.system(size: 9, weight: .heavy))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .foregroundStyle(.white)
            .background(Theme.ferryOrange, in: Capsule())
    }
}

struct StalenessBadge: View {
    let updatedAt: Date
    let now: Date

    var body: some View {
        let age = now.timeIntervalSince(updatedAt)
        if age > stalenessThreshold {
            Text(staleLabel(for: age))
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Theme.muted)
        } else {
            EmptyView()
        }
    }

    private func staleLabel(for age: TimeInterval) -> String {
        let mins = Int(age / 60)
        if mins < 60 { return "\(mins) min ago" }
        let hrs = mins / 60
        return "\(hrs) hr ago"
    }
}

struct PlaceholderView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "ferry.fill")
                .foregroundStyle(Theme.ferryOrange)
                .font(.title2)
            Text("Open Brisbane Ferry to set your route")
                .font(.caption)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Helpers

/// Countdown copy. Negative or zero = "Now"; <60 min = "in Xm"; >=60 min = "in Xh Ym".
func countdownText(minutes: Int) -> String {
    if minutes <= 0 { return "Now" }
    if minutes < 60 { return "in \(minutes) min" }
    let h = minutes / 60
    let m = minutes % 60
    return m == 0 ? "in \(h) hr" : "in \(h) hr \(m) min"
}
