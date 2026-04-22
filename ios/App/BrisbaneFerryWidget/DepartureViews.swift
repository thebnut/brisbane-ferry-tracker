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
//  Live countdown note: we render "in 6 min" via `Text(date, format:
//  .relative(presentation: .numeric, unitsStyle: .abbreviated))`.
//  WidgetKit auto-updates this text between our TimelineEntries without
//  requiring a re-render, so "in 6 min" correctly becomes "in 5 min"
//  a minute later. Our timeline entries still fire at each departure
//  time so the list itself re-sorts when a ferry passes.
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
            VStack(alignment: .leading, spacing: 3) {
                // Route header (origin → destination on one tight line)
                HStack(spacing: 2) {
                    Text(snapshot.outbound.originName)
                        .font(.caption2).fontWeight(.semibold)
                        .foregroundStyle(Theme.charcoal)
                        .lineLimit(1)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 8))
                        .foregroundStyle(Theme.muted)
                    Text(snapshot.outbound.destName)
                        .font(.caption2).fontWeight(.semibold)
                        .foregroundStyle(Theme.charcoal)
                        .lineLimit(1)
                }

                Spacer(minLength: 2)

                // Auto-updating live countdown — prominent
                Text(next.t, format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
                    .font(.system(.title3, design: .rounded).weight(.bold))
                    .foregroundStyle(Theme.charcoal)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                // Depart → arrive times
                HStack(spacing: 2) {
                    Text(next.t, style: .time)
                    if next.arrivalT != nil {
                        Image(systemName: "arrow.right").font(.system(size: 8))
                        Text(next.arrivalT!, style: .time)
                    }
                }
                .font(.caption2)
                .foregroundStyle(Theme.muted)

                // Badges row
                HStack(spacing: 4) {
                    if next.route == "F11" {
                        ExpressBadge()
                    }
                    if next.isLive {
                        LiveBadge()
                    }
                }
            }
        )
    }
}

// MARK: - DepartureRow (medium)

struct DepartureRow: View {
    let departure: WidgetSnapshot.Departure
    let now: Date

    var body: some View {
        HStack(spacing: 6) {
            // Depart → arrive pair
            HStack(spacing: 3) {
                Text(departure.t, style: .time)
                if departure.arrivalT != nil {
                    Image(systemName: "arrow.right").font(.system(size: 8))
                        .foregroundStyle(Theme.muted)
                    Text(departure.arrivalT!, style: .time)
                        .foregroundStyle(Theme.muted)
                }
            }
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .foregroundStyle(Theme.charcoal)
            .lineLimit(1)

            // Auto-updating relative countdown (WidgetKit refreshes this text
            // between timeline entries without new renders).
            Text(departure.t, format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
                .font(.caption2)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)

            Spacer(minLength: 2)

            if departure.route == "F11" {
                ExpressBadge()
            }

            if departure.isLive {
                LiveBadge()
            }
        }
    }
}

// MARK: - Badges

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

private struct ExpressBadge: View {
    var body: some View {
        Text("EXP")
            .font(.system(size: 9, weight: .heavy))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .foregroundStyle(.white)
            .background(Theme.ferryAqua, in: Capsule())
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
