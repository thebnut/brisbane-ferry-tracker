# @bft/train

BrisbaneTrain on the transit platform: Vite 8 + React 19.3 + React Router 8.4 framework mode on Cloudflare Workers
(`@cloudflare/vite-plugin`, SSR), styled with `@bft/ui` in the round-2 ferry look (the `T-*` boards in
`docs/design/transit/round2-ferry-look/`), data from the `/v1` contract (`@bft/core`). Same stack as `apps/ferry`.

```sh
pnpm --filter @bft/train dev            # http://localhost:5173, add ?fixtures=1 for recorded data
pnpm --filter @bft/train test           # unit tests (Vitest)
pnpm --filter @bft/train test:e2e       # Playwright smoke (builds, runs wrangler dev in fixture mode)
pnpm --filter @bft/train data           # rebuild app/data, public/data/train and the fixture from a GTFS dir
pnpm --filter @bft/train deploy:staging # https://bft-train.brisbanetransit.workers.dev
```

## Routes
- `/` home (T-Home): favourite trips (first three server-rendered from the `bft_fav` cookie), nearest station on
  request (geolocation), popular stations.
- `/station/:slug` (`?to=`) departures (T-Departures, T-Desktop), SSR with the rows in the HTML: platform tile with the
  orange "NOW n" tile for a platform change, stopping-pattern strip per departure in the line colour (hollow dots for
  stations an express runs through), countdowns, LIVE/GPS/SCHEDULED/CANCELLED/SKIPPED badges, platform-change banner,
  All/Express filter, favourite star, reachable-only "to" picker grouped by line, swap. Desktop with a destination shows
  both directions side by side. Unknown station: 404; unreachable `to`: ignored. Pair pages canonicalise to the
  station page.
- `/trip/:tripInstance` (`?from=&to=`) service detail (T-Detail): line, badges, platform tile, departs/journey/occupancy,
  vertical stopping pattern with separate arrival and departure times, platform per stop (with changes), stations
  passed through, and the train as a moving capsule positioned by time.
- `/stations` (`?from=&to=`) search (T-Search): uFuzzy over `data/train/stops.json` ("bowen hils" works) in the Ark UI
  combobox, "To" limited to reachable stations, the reachable-by-line list; without an origin it is the A–Z index of
  all 154 station pages.
- `/map` (`?station=`) live trains (T-Map): MapLibre loaded after hydration only, square pins (stations white, trains
  pulsing), tap a train for its service.
- `/alerts` line status (T-Alerts): every line's status chip from `/v1/alerts?mode=train`, "affects your trip" cards for
  favourites, all alerts.
- `/sitemap.xml` (home, stations, alerts, 154 stations), `/robots.txt` (disallow all unless `INDEXABLE=1`).

Dark mode follows the device (no flash: class set before paint), or Settings → Appearance (cookie, so SSR matches).

## Data
- Same-origin `/v1/*` proxy in the Worker (service binding `API` to `bft-api` in staging, `API_BASE` otherwise),
  contract-checked with the `@bft/core` zod schemas; the browser bundle carries only types.
- `scripts/build-data.ts` writes `data/train/stops.json` and `lines.json` in the pipeline's schemas (`StopIndexFile`,
  `LinesFile`, copied into core from `feat/p1-static-pipeline`) to `app/data/` and `public/data/train/`, plus
  `app/data/network.json` (6 KB gz): stations with platforms and display lines with their stopping patterns.
  Display lines (Springfield, Ipswich/Rosewood, …) are derived from TransLink's origin–destination route codes in
  `app/lib/lineNames.ts`. Once the pipeline publishes `data/train/*` to R2 the same schemas apply.
- Platform change: `mergeDepartures` in core sets `scheduledPlatform` when the RT stop-time update names another
  platform of the same parent station (`MergeOptions.stationPlatforms`); a stop id from another station is never a
  change.
- Staging reads live data from `bft-api` (which already serves train departures with `stopsAfter`).
- Fixture mode (`?fixtures=1` with `ALLOW_FIXTURES=1`, or `FIXTURES=1` for everyone): `fixtures/train-day.json` is one weekday's contract `TripIndexDay` (487 KB, server-only); each
  station's `StaticStopDay` is derived on first use like the pipeline does, merged with synthetic RT (delays,
  cancellations, a skipped stop, platform changes at the city stations), cached per 15 s cycle. A request costs
  2–4 ms CPU. The UI labels demo data.

## Offline
- PWA (vite-plugin-pwa 2): app shell and `data/train/*.json` precached; pages and `/v1/train` departures/trips network
  first with a 24 h cache.
- Favourites: the rest of today's timetable for each favourite is fetched after the home page is idle (paged with `at`,
  100 rows a page, at most hourly, skipped with Save-Data) and kept in localStorage. Offline, the board shows those
  rows as "Offline · scheduled".

## Hibernating-WebSocket prototype (ADR-0003)
`TRIP_WS=1` (on in staging and the Playwright server): service detail opens `/v1/train/trips/{key}/ws`, served by the
`TripSocket` Durable Object in this Worker (`workers/tripSocket.ts`, SQLite-backed, Hibernation API). One object per
trip refreshes the trip once per 15 s cycle (alarm aligned to the source cycle) and pushes only changes; the page stops
polling while the socket is open and falls back to polling on any failure. Measure with
`pnpm --filter @bft/train exec tsx scripts/ws-vs-poll.ts http://localhost:8797 20 300` against
`wrangler dev --var FIXTURES:1 --var TRIP_WS:1`. Results (20 viewers, 5 min): 40 upstream loads vs 400 for polling,
freshness p50 0.76 s vs 7.7 s; see `docs/architecture/transit-architecture.md` §5. It belongs in `services/edge` next
to the RtHub snapshot once that package is on this branch's base.

## iOS (Capacitor 8.5 scaffold)
`capacitor.config.ts` + `ios/` (Swift Package Manager). The app is server-rendered, so the shell loads the deployed site
(`CAP_SERVER_URL`, default staging) with `native-shell/index.html` as the offline error page. No signing, team or
App Store setup is committed. `pnpm --filter @bft/train ios:sync`, then `ios:open` and build in Xcode. Headless
`xcodebuild` on this Mac hung at "Resolve Package Graph" (package resolution on its own succeeds), so the simulator
build is not verified here. Widget (WidgetKit) and App Intents are not started.

## Measurements (18 Oct 2026, production build)

| | |
|---|---|
| Station page HTML (Central, 12 rows) | 11.5 KB gz (≤ 20 KB budget), rows in the HTML |
| First-load JS, station page | **150 KB gz** (budget 90 KB: not met) |
| CSS | 8 KB gz |
| Network data in the bundle | 6.2 KB gz |
| Lazy: map (MapLibre) / search combobox (Ark UI) | 272 KB / 33 KB gz |
| Worker upload | 1.86 MB (423 KB gz) |
| Fixture request CPU (Node) | 2–4 ms |
| Lighthouse 13.5 mobile, slow 4G, staging | Perf 99, A11y 100, BP 100, FCP = LCP 1.6–1.7 s, TBT 0, CLS 0 (SEO 69: staging is noindex) |
| Offline full day | Central (all trains) 687 rows, 353 KB raw / 14 KB gz; Roma Street → Indooroopilly 54 KB / 2.4 KB gz |

First-load JS: react-dom client 64 KB, React Router 41 KB, TanStack Query + data layer + network 30 KB, board UI
15 KB. As in `apps/ferry`, React 19 DOM plus React Router 8 are about 105 KB gz before any app code, so the 90 KB
budget is not reachable on the ADR-0005 stack; app code is about 45 KB. JS does not block LCP (rows are SSR).
