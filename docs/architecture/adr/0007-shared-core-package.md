# ADR-0007: `packages/core` contents and what is lifted from the archive

Status: Proposed, 18 October 2026.

## Decision
`packages/core` (TypeScript, no DOM, runs in Worker, browser and Node) contains the following.

### API contract
- zod schemas for every `/v1` response.
- The same schemas are used by the Worker, the apps, the MCP tools and the tests.

### Time
- Service-day arithmetic in `Australia/Brisbane`, using `@date-fns/tz` 1.5.
- GTFS times past 24:00 belong to the previous service day.
- The device timezone is never used.

### Calendar
- Resolves the active services per date from `calendar` and `calendar_dates`.
- Lifted from v7.1 `getActiveServices` and ferry `process-schedule.js`.

### Trip matching
Matching works on trip instances (`trip_id` + service date) and stop occurrences (`stop_sequence`). Tiers, in order:
1. Exact `trip_id` + `start_date`.
2. RT `(route, direction, start_time, start_date)`, which must identify exactly one instance.
3. Rail trip-ID prefix with a route tie-break, from the archive's `src/hooks/useTrainData.js` lines 79–150.
4. Same route within ±10 minutes at the same stop, from the archive's `src/services/ferryData.js` `mergeDepartures`.

Other rules:
- Tiers 3 and 4 also require a compatible direction and stop pattern, and **exactly one candidate**. Ambiguous matches stay unmatched.
- Report coverage, ambiguity and sampled precision for each tier.
- The RT stop-event state machine lives here too: arrival and departure predictions, SKIPPED, NO_DATA, CANCELED, ADDED and the rest, and expiry rules.

### Connectivity
- Reachable destinations per stop or station, from `schedule-processor/build-train-connectivity.js`.
- Mode-neutral once driven by a station grouping.

### Feed fetching
- Shares one in-flight promise per feed, from the archive's `gtfsService.fetchFeed`.
- Inside the throttle window it returns the last good feed, not `null`.

### Station slugs and stop keys
- Stable across timetable versions.

### Stop-event codec and deterministic NL parser
- These are shared by the pipeline, the edge and the AI layer.

## Not lifted
- The V7.1 all-pairs station and pattern blobs.
- The archive's `route.js` (hard-coded blob host, UTC "today").
- `ModeProvider` and `modeDetector`.
- The Redis code.

## Consequences
- The archive's known bugs are designed out, by tests on golden fixtures for three places per mode and on adversarial fixtures (repeated stops, 6-minute headways, cancellations, SKIPPED and NO_DATA stops, added trips, closures, 00:30 queries, a 03:00 feed swap). The bugs:
  - tomorrow's trips leaking into today
  - UTC dates
  - duplicate trips
  - direction errors
