# @bft/core

Shared transit core (ADR-0007). TypeScript, no DOM; runs in Workers, browsers and Node.

- `src/contract/` – the `/v1` contract (zod): static stop-day files, generation index, manifest, trip index,
  the RT snapshot (stop-event state), and every `/v1` response envelope. `SCHEMA_VERSION` versions all three layers.
- `src/time/` – service-day arithmetic in `Australia/Brisbane` (GTFS times past 24:00, D−1 lookups at 00:30).
- `src/calendar/` – `calendar.txt` + `calendar_dates.txt` → active services per date.
- `src/match/` – tiered RT-to-trip-instance matcher; ambiguous matches stay unmatched.
- `src/rt/state.ts` – the stop-event state machine (no propagation through NO_DATA, SKIPPED, cancellations).
- `src/merge/` – static stop-day files + RT snapshot → `/v1` departures.

Tests: `pnpm --filter @bft/core test` (adversarial fixtures in `test/adversarial.test.ts`; golden fixtures from the
real feed live with the pipeline, which builds them).
