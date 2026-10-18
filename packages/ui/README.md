# @bft/ui

Shared React 19 design system in the BrisbaneFerry look (round 2: `docs/design/transit/round2-ferry-look/`).

```css
/* app.css */
@import "tailwindcss";
@import "@bft/ui/theme.css";
```

- `src/theme.css`: Tailwind 4 `@theme` tokens (the single shared ferry palette, logo teal/orange, AA text variants
  `teal-text #1E7C80` and `aqua-text #007C99`, status colours, dark-mode surfaces, radii, shadows), gradients as
  utilities (`bg-page`, `bg-header`, `bg-strip`, `bg-board-header`, `bg-hot`, `bg-more`, `bg-departing`) and `tabular`.
  It `@source`s the component files, so apps get their classes generated.
- Components (`@bft/ui`): `AppHeader` (ferry: real lockup image with WebP `srcSet`; train/bus/transit: emblem +
  two-line Poppins wordmark), `SettingsPill`, `LivePill`, `StatusStrip`, `PillButton`, `FilterPills`, `BoardHeader`,
  `StopSelect`, `DepartureCard` (+ `highlighted`), `CountdownChip`, `StatusBadge`, `PrimaryButton`, `SecondaryButton`,
  `MoreButton`, `BottomNav`, `ModeTabs`, `PlatformTile` (orange "NOW n" change tile), `RouteTile` (orange for
  Metro/CityGlider), `StoppingPattern` (`compact` dots-only strip with hollow run-through dots and `gapBefore`),
  `LineChip`, `ServiceTimeline` (vertical line, separate arr/dep, the train as a moving capsule), `BottomSheet` (native `<dialog>` in a portal), `AlertCard`, `LineStatus` (status chips incl. `works` and a text override), `DepartureCard` `href`/`linkAs`,
  `EmptyState`, `ErrorState`, `OfflineBanner` ("Offline · scheduled", "Live times unavailable", stale, reloading).
- Bus (`src/bus.tsx`, B-* boards): `BigCountdown` (huge right-aligned "Now" / "4 min", clock past an hour),
  `RouteDepartureCard`, `SearchField` (orange "Stop name or number"), `ThumbSheet`, `StopResultCard` (PLAT tile, route
  chips, distance), `MyStopCard` (next 3 buses), `SegmentedControl`, `SaveButton`, `NoticeStrip`, `OccupancyMeter`,
  `TripTimeline`, `SkeletonRows`; `RouteTile` gained sizes (sm/md/lg/xl) and `routeTileVariant` now knows CityGlider
  (60, 61) and BUZ routes; `formatBusCountdown`. `MapView` gained a GeoJSON stops layer (`stops`, pin shape, click),
  a route `line` and `onViewChange`.
- Lazy entry points: `@bft/ui/map` (MapLibre GL 6 on OpenFreeMap, pulsing vehicle dots, pin shapes ferry circle /
  train square / bus diamond; about 280 KB gz, never on first load) and `@bft/ui/stop-search` (Ark UI combobox).
- `@bft/ui/format`: Brisbane-time helpers with the legacy rules: `formatCountdown` ("Departing", "in 1 min", none over
  60 min), `countdownTone` (<1 / ≤5 / ≤15 / later), `formatDuration` ("1 hr 28 mins"), `dayMarker` ("(19/10)"),
  `statusNote` ("Scheduled: …" / "Sched Dept: …"), `delayText`, `formatAge`, `vesselName`.
- `assets/`: ferry lockup (PNG + WebP 236/360/489 w) and emblems.

## AA contrast

Measured with Lighthouse/axe on the ferry app, the spec's own AA rule ("white on orange only large bold on #E55A2B")
still failed for 12–16 px text, so small white-on-orange text uses `ferry-orange-aa #C2410C` (5.18:1): LIVE pill and
badge, active filter pill, ≤5 min chip, primary button, platform-change and premium route tiles. The departing chip
gradient is `#DC2626 → #C2410C`. Orange text on white uses `ferry-orange-deep #B8400F` (5.56:1). The glow, borders and
large surfaces keep `#FF6B35`.

Tests: `pnpm --filter @bft/ui test` (countdown rules, status badges, platform change, route tiles, stop matching).
