# @bft/edge: /v1 API Worker and the RtHub realtime poller

Design: `docs/architecture/transit-architecture.md` §3.3, §3.8, §3.10 and ADR-0003. Data shapes: `@bft/core`.

| Piece | File |
|---|---|
| Worker entry (Hono app, 1-minute watchdog cron, DO export) | `src/index.ts` |
| /v1 routes + legacy `/api/gtfs-proxy` and `/schedule-data/latest.json` | `src/app.ts` |
| CORS (line-for-line port of `api/_cors.js`) | `src/cors.ts` |
| RtHub Durable Object shell / poller core (alarms, feeds, storage, R2) | `src/rt/hub.ts`, `src/rt/hub-core.ts` |
| Snapshot builder (decode → match → normalise → RtSnapshot) | `src/rt/build.ts` |
| Feed layout, `RT_MODES` / `RT_INDEX_MODES` | `src/rt/feeds.ts` |
| Edge snapshot read path (isolate memory, 10 s shared refresh with a 3 s deadline, R2 or RPC) | `src/snapshot-client.ts`, `src/r2-snapshots.ts` |
| DataSource: R2, assets Worker (service binding), local dir, memory | `src/data/` |
| Generated GTFS-RT types (`pnpm gen:proto`, buf + protoc-gen-es) | `src/gen/`, `proto/`, `buf.gen.yaml` |

## Configuration

| Var | Default | Meaning |
|---|---|---|
| `RT_MODES` | `ferry,train` | Per-mode TransLink feeds to poll, or `all` for the combined feeds. Free plan: per-mode ferry+train(+tram) fits 10 ms CPU; `all` needs Workers Paid (see the Phase 0 measurements). |
| `RT_INDEX_MODES` | polled modes minus bus | Modes whose trip indexes the hub loads. Bus doesn't fit a 128 MB DO with the current matcher. |
| `RT_UPSTREAM` | TransLink SEQ | GTFS-RT base URL. |
| `RT_CYCLE_MS` | `15000` | Poll interval. The alarm itself fires every 7.5 s (or less) so the DO stays resident: Cloudflare evicts an object after ~10 s idle, which would drop its trip indexes every cycle. |
| `RT_SNAPSHOT_MAX_STALE_MS` | `60000` | How old an edge isolate's snapshot copy may be before a request waits for the refresh (min 10000). Lower trades latency for freshness: each wait is one R2 read (~300 ms from BNE). The wait is capped at 1.5 s; after that the request gets the old copy with `rtState` `stale`. |
| `RT_WAIT_MS` | `1200` | The most any request waits for realtime (cold isolate or expired copy; 100 ms to 3 s). Past it the request answers scheduled rows with `rtState` `stale` (an expired copy) or `unavailable` (none); the refresh keeps running and commits for the next request. A request also stops waiting when its caller aborts, and every GET is cut off at 7 s (503 `timeout`; 499 when the caller left first). |
| `RT_PROFILE` | unset | `1` logs `rt cycle timings` (restore, indexes, fetch, decode, build, persist, publish, total; R2 PUT count and size) for every hub poll. Polls of 2.5 s or more are always logged, as a warning. In workerd the clock only moves across I/O, so CPU-only phases read ~0. |
| `CORS_ALLOW_ALL` | `false` | Break-glass wildcard CORS, as in the legacy proxy. |
| `DATA_BUCKET` (R2) | staging: `bft-transit-data` | Static tree + `rt/` snapshots. Takes precedence over `DATA`. |
| `DATA` (service) | dev: `bft-data-dev` | Assets Worker fallback (`services/data`). |
| `DRILL_TOKEN` (secret) | unset | Enables `POST /__drill/kill-alarm` (bearer token) for the watchdog drill. |
| `SPIKE_ENABLED` | unset | Enables `/__spike/rt?runs=N` (Phase 0 CPU timing inside workerd). Dev only. |

## Run and test

```sh
pnpm install                              # from the repo root
pnpm --filter @bft/edge test              # vitest: hub, app/contract, CORS parity, shadow diff, feeds
pnpm --filter @bft/edge typecheck && pnpm --filter @bft/edge lint

# Local workerd (Worker + DO + assets data Worker), against a dev tree built from an unzipped GTFS:
cd services/edge
node --experimental-transform-types scripts/dev-tree.ts --gtfs /tmp/bft-gtfs/x --out ../data/out \
  --dates 20261017,20261018,20261019 --modes ferry,train
pnpm exec wrangler dev -c wrangler.jsonc -c ../data/wrangler.jsonc --test-scheduled
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'      # start the hub via the watchdog
curl http://localhost:8787/v1/health
```

## Deploy (workers.dev staging only)

```sh
pnpm --filter @bft/edge deploy:staging     # bft-api.brisbanetransit.workers.dev, R2 bft-transit-data
```

The first cron can take several minutes to start after a fresh deploy; the watchdog then starts the alarm chain.

## Phase 1 tools

```sh
# Shadow diff: /v1/ferry vs the legacy app's computed departures, every ferry pair (±1 min, same trips).
pnpm --filter @bft/edge shadow-diff --legacy path/to/latest.json --data ../data/out --out report/
# Against a deployed /v1 instead (real time, first 100 departures per pair):
pnpm --filter @bft/edge shadow-diff --legacy path/to/latest.json --api https://bft-api.brisbanetransit.workers.dev

# Freshness (source age p50/p95/max) and latency (p50/p75) against staging:
pnpm --filter @bft/edge freshness --url 'https://bft-api.brisbanetransit.workers.dev/v1/ferry/stops/317584/departures' --duration 600

# Phase 0 CPU / memory spike (Node; same code path as the DO):
pnpm --filter @bft/edge spike [--fresh]

# Watchdog drill on staging: kill the alarm chain, then watch /v1/health recover.
curl -X POST -H "Authorization: Bearer $DRILL_TOKEN" https://bft-api.brisbanetransit.workers.dev/__drill/kill-alarm
```

The nightly `.github/workflows/transit-shadow-diff.yml` runs the shadow diff in Actions (read-only, artifact upload).

## Realtime freshness: log lines to alert on (R14-RT1)

A stall where the hub keeps polling but realtime stops moving used to log nothing (staging, 20 Oct 2026: TransLink's
TripUpdates header time stood still from about 07:48 to 07:55Z while every fetch answered 200). These lines make it
visible in Workers Observability (`bft-api` staging, `bft-api-prod` production):

| `msg` | Level | Logged by | When | Fields |
|---|---|---|---|---|
| `rt source stale` | warn | hub (`svc: bft-rthub`) | once per feed per episode: TransLink's header time unchanged for 3 successful polls and over max(90 s, 3 polls) old | `feed`, `sourceTimestamp`, `ageS`, `polls`, `seq` |
| `rt source recovered` | info | hub | that feed's header time moves again | `feed`, `sourceTimestamp`, `staleS` (episode length), `polls`, `seq` |
| `rt stale` | warn | watchdog cron (`svc: bft-api`) | every minute while the published status (the R2 pointer health reads) is past health's 120 s | `reasons` (`source-age`, `build-age`), `ageS`, `buildAgeS`, `seq`, `hubAges` (the hub's own view) |
| `request` with `path: /v1/health`, `status: 503` | info | API | each failing health check | `error: health not ok`, `detail` such as `source-age 446s` or `manifest,build-age 130s` |

The `/v1/health` body says the same thing for a caller: `reasons` lists every failing check in that fixed order
(`manifest`, `source-age`, `build-age`) and is always present, an empty list on a 200; `rt.ageS` and `rt.buildAgeS` are
the measured ages (null when unknown). Both fields are optional in the `HealthResponse` contract, so older deploys
still parse.

Reading them: `rt source stale` with `rt stale` reasons `[source-age]` is an upstream freeze (nothing for us to fix
but to show it). `rt stale` with `build-age` while `hubAges` is fresh means the hub is fine and its status isn't
reaching readers (a lost pointer write). `rt stale` with no `rt source stale` and a stale `hubAges` too means the hub
itself stopped building; the `watchdog` line's `rearmed` says whether the cron restarted it.

Alerts are account-level (Workers Observability alerts or a Notifications policy), not repo config, so they are set up
in the dashboard. Suggested, per Worker:

- **Page**: `msg = "rt stale"`, count ≥ 3 in 5 minutes (three consecutive watchdog minutes, so a single slow publish
  never fires).
- **Notify**: `msg = "rt source stale"`, count ≥ 1 in 5 minutes (the earliest signal: it precedes the health 503s by
  about 30 s).
- **Notify**: `path = "/v1/health"` and `status = 503`, count ≥ 5 in 5 minutes, grouped by `detail`.

The same filter by hand, with the Cloudflare API (`POST /accounts/{account}/workers/observability/telemetry/query`,
`view: "events"`, a 1 to 6 h `timeframe`): filters `$metadata.service = bft-api` and `msg = rt source stale` (or
`rt stale`).
