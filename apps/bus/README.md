# @bft/bus

BrisbaneBus on the transit platform (phases 6–7 of `docs/architecture/transit-architecture.md`): Vite 8 + React 19.3 +
React Router 8.4 framework mode on Cloudflare Workers (SSR), styled with `@bft/ui` in the round-2 ferry look (the
`B-*` boards in `docs/design/transit/round2-ferry-look/project/`), data from the `/v1` contract (`@bft/core`) and the
static client data under `data/bus/`. Same stack and conventions as `apps/ferry`.

```sh
pnpm --filter @bft/bus data             # build public/data/bus/* + fixtures from a GTFS dir (default /tmp/bft-gtfs/x)
pnpm --filter @bft/bus dev              # http://localhost:5173, add ?fixtures=1 for recorded data
pnpm --filter @bft/bus test             # unit tests (Vitest)
pnpm --filter @bft/bus test:e2e         # Playwright smoke + throttled search perf (builds, wrangler dev, fixtures)
pnpm --filter @bft/bus deploy:staging   # bft-bus.brisbanetransit.workers.dev (run `pnpm data` first)
pnpm tsx scripts/measure-payload.ts <pipeline out dir> [stopKey…]   # busiest-stop /v1 payload on real data
```

Staging: https://bft-bus.brisbanetransit.workers.dev (workers.dev only; `?fixtures=1` for demo data).

## Routes

| Path | Board | What |
|---|---|---|
| `/` | B-Home, B-Search, B-Desktop | "My stops" cards with each saved stop's next 3 buses (first 3 saved stops are server-rendered via the `bft_bus_saved` cookie). Search-first: on phones the "Stop name or number" field sits in a sheet at thumb height above the bottom nav and results stack upward, best match nearest the thumb; on desktop the field is in the page and saved stops are full boards side by side (5 rows + "More departures"). Quick chips: Near me, recent stops. |
| `/stop/:stopId` | B-Departures, B-States | SSR stop board: rows are in the HTML (loader calls `/v1` in-process), then 15 s polling. Teal route tiles (orange for Metro, CityGlider and BUZ), huge right-aligned tabular countdown, LIVE / SCHEDULED / CANCELLED badges with "On time", "+2 min late", "GPS · …", "Next 111 in 18 min", detour notes; busway platform codes; route filter pills; save star; alert strip; lazy per-stop map with the buses heading there; "No more buses tonight" + first bus tomorrow; loading skeleton, error and offline/stale/reloading/unavailable banners. JSON-LD `BusStop`, canonical. |
| `/trip/:tripInstance?from=` | B-Detail | One bus: hero card (route tile, destination, LIVE/GPS, countdown at your stop), occupancy / bus / journey tiles, stops on this trip with the bus as a ringed dot, Track on map, save stop. `noindex`. |
| `/route/:route` | B-Map | Route detail and per-route map: direction toggle, MapLibre (lazy) with the line, stops as bus diamonds and live buses (`?trip=` highlights one), bus list sheet, SSR stop list. |
| `/map` | B-Map | Every stop on a map; scope Near me / My stops; locate button. |
| `/nearby` | (B-Home chips) | Geolocation permission UX (explain first, locate straight away only when already granted, denied/unavailable states), geohash-5 tile + 8 neighbours, haversine sort, ≤ 2 km. `?lat=&lon=` for links and tests. |
| `/alerts` | B-Alerts | Detours first, changed stops, planned, info; scope My stops (saved stops + their routes) / All routes; nav badge count. |
| `/about` | | Data sources, attribution (CC BY 4.0), what stays on the device. Server-rendered (carries the CSP nonce). |
| `/sitemap.xml` | | Sitemap index → `/sitemaps/pages.xml`, `/sitemaps/routes.xml` (472 routes), `/sitemaps/stops-1..3.xml` (12,364 stops, 5,000 per file), built in the Worker by scanning the raw index text (no `JSON.parse`, inside the Free CPU budget). `/robots.txt` points at it. |

Dark mode: Auto / Light / Dark in Settings; a cookie lets the server render the right class and an inline head script
applies it before paint (no flash). Header wordmark and emblem follow B-DarkWidget.

## Data

- **Same-origin proxy** in the Worker for `/v1/*` and `/data/bus/*` (service binding `API` to `bft-api` on staging,
  `API_BASE` over HTTP otherwise). Every proxied response and every SSR loader response is validated with zod (the
  `/v1` contract from `@bft/core`, the client-data contract in `app/lib/data-contract.ts`); drift becomes a 502, so
  the browser ships only types. The 1.6 MB stop index is checked shallowly at the edge (envelope + first 200
  entries) to stay inside the Workers Free 10 ms CPU budget; the unit tests parse the whole file.
- **Static client data** (`data/bus/stops.json`, `geo/{geohash5}.json`, `lines.json`) has the pipeline's shapes
  exactly (`app/lib/data-contract.ts` mirrors the pipeline's `@bft/core` additions until that PR lands here). When
  `pnpm data` has run, the build carries them as static assets (free, before the Worker); otherwise the Worker
  proxies the API's `/data/bus/*`. `public/data/` is gitignored.
- **`data/bus/routes/{route}.json`** (new, proposed for the pipeline): one line's two busiest patterns per direction
  with stop names and positions, so a route page renders server-side without the whole stop index. `pnpm data`
  builds it for now (472 files).
- **Search** (`app/lib/search.ts`): uFuzzy 1.0.19 over stop names (one typo per word, words at word starts, out of
  order when nothing else matches) plus exact stop-number matching (`10802`, `010802`, `stop 10802`). The index loads
  after first paint (idle callback) or on first keystroke, and the service worker keeps it (stale-while-revalidate).
- **Nearby** (`app/lib/geo.ts`): the pipeline's geohash encoder; own cell + 8 neighbours so stops just across a cell
  edge are found (tested with a stop 40 m away in the next cell beating one 600 m away in the same cell).
- **Map stops layer: GeoJSON**, not PMTiles: the pipeline doesn't publish a PMTiles archive yet. The map loads the
  geohash tiles covering the view (zoom ≥ 14, ≤ 16 tiles) into one symbol layer of bus diamonds.
- **Fixture mode** (`?fixtures=1` when `ALLOW_FIXTURES=1`, or `FIXTURES=1`): `/__fixtures/*` serves responses merged by
  `@bft/core` `mergeDepartures` from one real weekday of stop-day files (Cultural Centre P1/P2, King George Square
  1a/2a, Mater Hill P1, Adelaide St stop 37; trip index for M1, M2, 60) with a deterministic synthetic RT snapshot
  and four fixture alerts, rebased to today (`fixtures/bus-day.json`, 1.4 MB, server-only). Fixture client data uses
  the built full index when present, else the fixture subset. `?rt=unavailable|stale|reloading` forces a state.
  Staging sets `FIXTURE_FALLBACK=1`: when the API errors the pages use fixture data and say "Demo data".
- **Offline**: saved stops keep a 100-departure timetable copy (refreshed at most every 3 h); offline, the board
  shows it as scheduled times under "Offline · scheduled". Pages and `/v1/bus` responses are network-first in the
  service worker; the search index and used geo tiles are stale-while-revalidate.

## Measurements (18 Oct 2026)

**Search speed** (Playwright, Pixel 7 profile, Chromium with **4× CPU throttling** via CDP, full 12,364-stop index,
10 realistic queries typed a key at a time, 96 searches): **p50 2.4–2.8 ms, p95 6.0–6.8 ms, max 14–15 ms** (budget
p95 < 50 ms). Node, unthrottled: index build 7.6 ms; a one-letter query (6,254 matches) 8.6 ms, which is why searching
starts at two characters (or one digit).

**Busiest-stop payload** (budget < 20 KB), `/v1/bus/stops/{key}/departures` at the edge's default limit 20:

| Source | Cultural Centre P2 (11168) | Cultural Centre P1 (10802) | South Bank P4 (19064) |
|---|---|---|---|
| Deployed `bft-api` staging (real pipeline data, scheduled-only) | 8.2 KB raw / 1.1 KB gz | 8.1 KB / 1.2 KB | 8.2 KB / 1.1 KB |
| Pipeline output tree + `@bft/core` merge (`scripts/measure-payload.ts`) | 7.9 KB / 1.1 KB | 7.9 KB / 1.1 KB | 8.0 KB / 1.1 KB |
| Fixture API with synthetic RT (unit test) | < 20 KB raw asserted; limit 100 < 20 KB gz | | |

Limit 100 (the offline copy) is 38 KB raw / 2.1 KB gz. The stop-day file behind it is 28.8 KB gz (pipeline) /
39.4 KB gz (this app's builder, which keeps stop names in downstream refs).

**Static client data** (`pnpm data`, feed of 17 Oct 2026): `stops.json` 12,364 stops, 1,590 KB raw, **306 KB gz,
203 KB br** (the pipeline's file: 313 KB gz; the architecture's 214 KB estimate was brotli without route lists);
248 geo tiles (median ~5 KB); `lines.json` 472 lines, 64 KB gz / 47 KB br. Stop-day files: median 1.3 KB gz, p95
4.8 KB gz, max 39 KB gz. Build: 3.1 M bus `stop_times` rows streamed in 2.9 s, 133 s total, 0.9 GB peak RSS.

**Lighthouse 13.5** mobile (simulated slow 4G, 4× CPU), staging `bft-bus.brisbanetransit.workers.dev`, real data:

| Page | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/stop/11168` | 99 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0 |
| `/` | 98 | 100 | 100 | 100 | 1.8 s | 1.8 s | 0 ms | 0 |

SSR stop page HTML 8.5 KB gz with 20 rows; CSS 8.6 KB gz. First-load JS about **146 KB gz** (home) / 149 KB (stop),
like ferry: React DOM + React Router are ~105 KB of it; uFuzzy (4 KB) rides in the data chunk. Lazy: MapLibre
(279 KB gz, stubbed out of the Worker bundle).
