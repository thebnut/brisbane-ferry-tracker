# ADR-0003: One shared realtime poller (Durable Object) with edge-merged, pull-based responses

Status: Proposed, 18 October 2026. Revised after the Codex review (findings 2, 3, 4, 7, 8, 10, 14).

## Context
- Each client today fetches the full 290 KB TripUpdates feed through `/api/gtfs-proxy` and decodes it in the browser.
- TransLink's feed refreshes every 10 s (`max-age=10`, ETag). It is licensed CC BY 4.0, needs no authentication, and has no stated rate limit.
- Measured, Saturday midday: 1,231 trips, 21,830 stop updates, 707 vehicles, 67 alerts. Decode takes 13 ms.

## Decision
- **Poller:** an `RtHub` Durable Object (location hint `oc`) with an alarm every 15 s.
  - It polls the combined TripUpdates and VehiclePositions feeds every 15 s and alerts every 60 s, with `If-None-Match`.
  - That is about 12k TransLink requests a day, whatever the user count.
- **Scheduler robustness:**
  - The handler re-arms the next alarm first, before any work, and again in `finally`.
  - Each upstream fetch has a 5 s timeout.
  - Publishing is idempotent (sequence-numbered snapshot, then a `latest` pointer).
  - A 1-minute Cron Trigger watchdog re-arms the alarm if the last cycle is more than 45 s old.
  - Alert summaries run off the polling path.
- **Processing:**
  - Decode with `@bufbuild/protobuf` 2.16 using generated GTFS-RT types.
  - Match RT trips to **trip instances** with the tiered `packages/core` matcher (ADR-0007).
    - Every fallback tier requires **exactly one** compatible candidate.
    - Ambiguous trips stay unmatched.
  - Maintain a stop-event state machine:
    - separate arrival and departure predictions
    - SKIPPED and NO_DATA stops
    - CANCELED, ADDED, DUPLICATED and REPLACEMENT trips
    - source timestamps
  - Delays never propagate through NO_DATA. Cancellations never silently revert to scheduled.
  - Trip indexes for yesterday's and today's service days are held in typed arrays, for after-midnight service.
- **Publish:**
  - Each cycle writes one `rt/snapshot-{seq}.bin` to R2, then the `rt/latest.json` pointer. That is about 175k writes a month, under the free 1M.
  - The header carries `schemaVersion`, `staticGeneration`, `serviceDates`, `sourceTimestamp` and `fetchedAt`.
  - The latest raw protobufs are kept in DO storage for the legacy proxy route.
- **Serve:**
  - Edge Workers keep the parsed snapshot in isolate memory, refreshed after 10 s through a shared cache entry with in-isolate promise sharing.
  - They merge it with the static stop file **only if the static generations match**. Otherwise they serve scheduled-only rows marked `reloading`.
  - Responses are 1–3 KB, with `max-age` capped by snapshot age.
  - Workers Cache (pre-Worker caching with request collapsing) is benchmarked in Phase 1 for the API Worker only.
  - The DO stays off the per-request path, so its cost doesn't grow with traffic.
- **Delivery is pull first.** Clients poll every 15 s while visible and pause when hidden.
- **Hibernating WebSockets** (no idle duration billing) are prototyped in Phase 4 for long-lived views such as service detail and the live map, and adopted only if measured cost and freshness beat polling.

## Alternatives
- **Cron Trigger + KV:** the 1-minute minimum is too coarse, and KV allows 1k writes a day.
- **Vercel Cron or Fluid compute:** Hobby cron runs once a day, and Pro costs $20/month.
- **Fly.io:** about $2–3/month, and another platform to run.
- **Deno Deploy cron:** 1-minute minimum.
- **Supabase pg_cron:** an unneeded database, and the free tier pauses.
- **Redis:** the archive hit timeouts with it.
- **SSE:** holds a non-hibernating request per user.
- **WebSockets as the default:** more moving parts (fan-out, reconnects) than departure boards need. Kept as a measured option rather than rejected.

## Consequences
- End-to-end freshness, from source timestamp to screen, is about 20–25 s at p50 and about 50 s in the worst case. The UI shows the true source age.
- The cost is fixed and tiny.
- TransLink sees one polite client.
- The legacy `/api/gtfs-proxy` stays cheap for old iOS builds.
