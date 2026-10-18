# Codex cross-review of the transit architecture

## Review run

- **Reviewer:** Codex CLI, model `gpt-6-astra`.
- **Command:** `codex exec --sandbox read-only "Critically review docs/architecture/transit-architecture.md (and docs/architecture/adr/*) for cost, scale, correctness and missed modern options. …"`
- **Date:** 18 October 2026.
- **What it reviewed:** the first draft of `transit-architecture.md`, all nine ADRs and the measurement scripts, before the first commit on `docs/transit-architecture`. It checked GTFS, GTFS-RT and Cloudflare documentation and edited nothing.
- **Overall verdict:** "The overall direction is sound, but the proposal needs changes before implementation." It found the biggest gaps in GTFS correctness, recovery behaviour, and freshness and cost assumptions.

**Outcome:** 14 findings (6 high, 7 medium, 1 low). All 14 were accepted and addressed in the committed version. None were rejected. One finding (11) reversed a decision: custom day packs were replaced with content-addressed per-stop files. One finding (1) led to re-running the measurements.

## Findings and responses

| # | Severity | Finding (short) | Response | Where |
|---|---|---|---|---|
| 1 | High | The measured format used departure times as "arrivals". It dropped seconds, trip identity and pickup/drop-off rules. | **Accepted, re-measured.** `measurements/measure2.py` now records downstream **arrival** seconds, `stop_sequence`, trip ID and drop-off rules, and skips no-pickup events. Bus went from 8.2 to **11.5 MB** a day in total (p95 1.8 to 2.5 KB, max 17.8 to 24.1 KB). Train went from 150 to 300 KB. The figures are now labelled lower bounds, to be re-measured in Phase 0 with the final schema. The stop-event schema is defined in §3.2. | §1, §3.2, §5, ADR-0002 |
| 2 | High | Trip-matching fallbacks can produce false matches on frequent routes, loops and branches. | **Accepted.** Matching now works on trip instances and stop sequence. Every fallback tier needs a unique, direction- and pattern-compatible candidate, and ambiguous matches stay unmatched. Coverage, ambiguity and sampled precision are all measured. Adversarial fixtures were added. A new high risk was recorded. | §3.3, §3.7, §8, ADR-0003, ADR-0007 |
| 3 | High | The RT schema is too thin to merge safely: NO_DATA, SKIPPED, cancellations, added trips, arrival versus departure. | **Accepted.** There is now a stop-event state machine. It has separate arrival and departure predictions and covers stop and trip relationships. Delays never propagate through NO_DATA, a stale cancellation shows as "status unknown", and source timestamps are kept. | §3.3, ADR-0003 |
| 4 | High | No compatibility between static generation and RT snapshot. | **Accepted.** Immutable static generations, with the previous one retained. The snapshot and every response carry `schemaVersion`, `staticGeneration`, `serviceDates` and `rtSourceTimestamp`. The edge merges only matching generations and otherwise serves scheduled-only rows marked `reloading`. The hub reloads on manifest change. | §3.2, §3.3, §3.8, ADR-0002 |
| 5 | High | "Every station has service every day" blocks valid closures, and 3 days is too little lookahead. | **Accepted.** Structural corruption (fail closed) is now separated from plausible service changes (quarantine, open an issue, one-click promote, closures explained by `calendar_dates` auto-pass). Lookahead is 7 days (D−1 to D+6), rebuilt from the last valid feed. | §3.2, §3.10, ADR-0002, ADR-0009 |
| 6 | High | Midnight lookup and overnight trip retention were unspecified. | **Accepted.** Queries cover every overlapping service day, including D−1. The hub keeps trip indexes for yesterday and today, and trips are deduplicated by trip instance. Fixtures were added for 00:30 and the 03:00 feed swap. | §3.2, §3.3, §3.7 |
| 7 | Medium | "10–25 s freshness" ignored most of the delivery path. | **Accepted.** Freshness is now defined from source timestamp to screen. The worst case is shown as about 50 s and p50 as about 20–25 s. Cache `max-age` is capped by source age, the UI shows the true age, and Phase 1 must show p95 ≤ 40 s. | §3.3, ADR-0003 |
| 8 | Medium | A durable alarm is not a self-healing scheduler. | **Accepted.** The alarm is re-armed before work and in `finally`. Fetches have 5 s timeouts and publishing is idempotent. A 1-minute Cron Trigger watchdog was added. Raw feeds persist in DO storage, and alert summaries run off the polling path. Phase 1 includes a kill-the-alarm drill. | §3.3, §3.10, ADR-0003 |
| 9 | Medium | The cost model assumed only about 2 minutes of use and omitted SSR, widgets and per-PoP R2 reads. It should compare Vercel using the same design. | **Accepted.** The model was rebuilt from visible minutes, sessions, SSR, widgets and bot overhead. The base case is 35 requests per DAU and the heavy case 120. 100k DAU is now **about $37** (base) to **about $124** (heavy) for infrastructure, against $12 before. The free cap is about 2.9k DAU. Per-PoP snapshot reads were added. The Vercel comparison now uses the same design: about $330 or more. The poll interval is identified as the cost lever. | §1, §6, ADR-0001 |
| 10 | Medium | The Cache API doesn't coalesce misses. Workers Cache is a missed modern option. | **Accepted.** The doc now says the Cache API doesn't coalesce. Promise sharing within an isolate was added. Workers Cache is benchmarked in Phase 1 **only on the API Worker**, and static files sit in a separate assets-only Worker so they stay unmetered. | §3.3, §3.6, ADR-0001, ADR-0003 |
| 11 | Medium | Custom packs were justified by a small billing threshold and ignore engineering cost. Quadratic downstream suffixes. | **Accepted, decision reversed.** Content-addressed per-stop day blobs plus a per-generation index replace the packs. Uploads now cover only changed content. Phase 0 benchmarks this against grouped shards and a pattern + trip-times representation, which removes suffix repetition. | §3.2, §4, ADR-0002 |
| 12 | Medium | Injected JSON is not visible markup, the "no server runtime" claim was contradictory, and the LCP estimate was optimistic. | **Accepted.** Stop and station routes are now **server-rendered in the API Worker with departure rows in the HTML**, plus hydration state: a stated server runtime. SSR page views are counted as metered requests. The LCP budget lists cold-path costs, and 1.5 s is now an acceptance target measured cold and warm on a mid-range Android. | §3.1, §3.5, ADR-0005 |
| 13 | Medium | The AI controls weren't a hard cap: the rate-limit binding has only 10 s or 60 s windows, the second provider sits outside the Anthropic cap, and there were race conditions. | **Accepted.** The binding is used only for burst protection. A strongly consistent Budget DO ledger now holds daily per-IP quotas and a global **dollar** budget, with an atomic reservation before every attempt (retries and summaries included) and reconciliation afterwards. There is no second paid provider by default. | §3.9, ADR-0008 |
| 14 | Low | Rejecting WebSockets used an outdated cost argument, since hibernation exists. | **Accepted.** Polling stays the default. Hibernating WebSockets are a measured option for service detail and the live map, prototyped in Phase 4. SSE stays out. | §3.3, §4, §7, ADR-0003 |

## Not changed

- The overall direction, which Codex called sound:
  - Cloudflare edge
  - a shared poller
  - per-stop static data
  - client-side search
  - a monorepo with standalone apps
  - an optional, deterministic-first AI layer
- No second review of the revised document was run. Per the global AGENTS.md, cross-model review is required only for production code, and a review of a review isn't needed. Implementation PRs from Phase 0 onwards will each get their own cross-model review.
