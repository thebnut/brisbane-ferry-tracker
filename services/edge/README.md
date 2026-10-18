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
| Edge snapshot read path (isolate memory, 10 s SharedFetch, R2 or RPC) | `src/snapshot-client.ts`, `src/r2-snapshots.ts` |
| DataSource: R2, assets Worker (service binding), local dir, memory | `src/data/` |
| Generated GTFS-RT types (`pnpm gen:proto`, buf + protoc-gen-es) | `src/gen/`, `proto/`, `buf.gen.yaml` |

## Configuration

| Var | Default | Meaning |
|---|---|---|
| `RT_MODES` | `ferry,train` | Per-mode TransLink feeds to poll, or `all` for the combined feeds. Free plan: per-mode ferry+train(+tram) fits 10 ms CPU; `all` needs Workers Paid (see the Phase 0 measurements). |
| `RT_INDEX_MODES` | polled modes minus bus | Modes whose trip indexes the hub loads. Bus doesn't fit a 128 MB DO with the current matcher. |
| `RT_UPSTREAM` | TransLink SEQ | GTFS-RT base URL. |
| `RT_CYCLE_MS` | `15000` | Poll interval. The alarm itself fires every 7.5 s (or less) so the DO stays resident: Cloudflare evicts an object after ~10 s idle, which would drop its trip indexes every cycle. |
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
