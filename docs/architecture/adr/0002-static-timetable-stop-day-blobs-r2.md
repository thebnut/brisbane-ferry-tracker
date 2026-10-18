# ADR-0002: Static timetable as content-addressed per-stop day files on R2, built by GitHub Actions

Status: Proposed, 18 October 2026. Revised after the Codex review (findings 1, 4, 5, 6, 11).

## Context
- Today, 2.9 MB of ferry JSON is committed to git every day and filtered in the browser.
- The archived train attempt produced 14–19 MB JSON files, then about 320 MB to 3.6 GB of per-station blobs, by enumerating every origin–destination pair.
- Measured on the 17 October 2026 feed, using stop events that carry:
  - downstream **arrival** seconds
  - pickup and drop-off rules
  - `stop_sequence` and trip ID
- One service day for the whole network is **11.5 MB gz**. The median stop file is 0.6 KB, p95 is 2.5 KB, and the largest is 24 KB. These are lower bounds for the final schema.

## Decision
- **Contract first.** `packages/core/contract` defines the stop-event schema before any format code. Each stop event holds:
  - trip instance (`trip_id` + service date)
  - stop sequence
  - separate arrival and departure times
  - pickup and drop-off rules
  
  The contract is tested against golden and adversarial fixtures.
- **Build:** a daily GitHub Action, at 03:00 AEST and on manual trigger, in this public repo at no cost.
  - It builds service days **D−1 to D+6** from the feed, which covers about 60 days.
  - If a run fails, future days are rebuilt from the last valid source feed.
- **Validation in two classes:**
  - **Structural corruption fails closed.** Triggers: validator ERRORs, missing files, broken references, `feed_end_date` earlier than today + 7, golden fixtures failing.
  - **Plausible service changes are quarantined.** Triggers: count swings over ±20%, an unexplained zero-service station.
    - The build publishes to staging and opens an issue, and a `workflow_dispatch` promotes it.
    - Closures that `calendar_dates` explains pass automatically.
- **Storage:**
  - Blobs are content-addressed: `static/blobs/{sha256}.json.br`.
  - A per-generation index, `static/{generation}/{mode}/index.json`, maps `(date, stopKey) → hash`.
  - Only changed content is uploaded, which keeps R2 Class A operations under the 1M free tier.
  - `manifest.json` (60 s TTL) is written last. It maps `mode/date → generation`, keeps the previous generation for rollback, and makes the switch atomic.
  - A weekly garbage-collection step removes unreferenced blobs.
- **Consistency:** the static generation is recorded in the RT snapshot and in every API response. The edge merges static and RT data only when the generations match.
- **Client data:**
  - Stop index, geohash tiles and lines/patterns are built into each app's assets and refreshed daily from R2.
  - The bus stop map layer is PMTiles.
- **Nothing in git.** The legacy `latest.json` for old iOS builds is published as a GitHub Pages Actions artifact, not as a commit.
- **Phase 0 benchmarks** this format against grouped shards and a pattern + trip-times representation, comparing size and operating effort.

## Alternatives
- **Custom day packs with range reads:** the first draft. Codex review showed bespoke index, range-read and corruption handling for a saving of a few dollars a month.
- **Workers KV:** 1k writes a day on Free.
- **Vercel Blob:** metered egress.
- **SQLite-WASM or DuckDB-WASM in the browser:** 1–4 MB of WASM on the LCP path.
- **Protobuf or MessagePack:** about 20% smaller, less debuggable.
- **Building inside Workers:** 128 MB of memory against a 199 MB `stop_times.txt`.

## Consequences
- A departure board read is a few KB.
- Train (300 KB/day) and ferry (30 KB/day) can prefetch today for offline use.
- Service survives six failed pipeline runs.
- Valid closures don't block publication.
