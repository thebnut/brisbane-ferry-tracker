//
//  Theme.swift
//  BrisbaneFerryWidget
//
//  Brand colour constants for the widget. Duplicated from the React
//  bundle's tailwind.config.js because the widget extension is a
//  separate process and can't import anything from the React runtime.
//
//  If the brand palette changes in tailwind.config.js, update these to
//  match. A future improvement is to code-gen this file from the
//  Tailwind config at `cap sync` time (tracked separately, not v1).
//

import SwiftUI

enum Theme {
    /// #FF6B35 — primary brand colour, used for accents and the LIVE badge.
    static let ferryOrange = Color(red: 1.0, green: 107.0/255.0, blue: 53.0/255.0)

    /// #4ECDC4 — secondary accent.
    static let ferryAqua = Color(red: 78.0/255.0, green: 205.0/255.0, blue: 196.0/255.0)

    /// #FFE5D9 — warm cream background matching the app's status-bar tint.
    static let cream = Color(red: 1.0, green: 229.0/255.0, blue: 217.0/255.0)

    /// #2C3E50 — primary text colour; high contrast against cream.
    static let charcoal = Color(red: 44.0/255.0, green: 62.0/255.0, blue: 80.0/255.0)

    /// Muted grey for secondary text (staleness, helper copy).
    static let muted = Color(red: 107.0/255.0, green: 114.0/255.0, blue: 128.0/255.0)
}
