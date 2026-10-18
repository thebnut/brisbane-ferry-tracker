# ADR-0009: Operations on free tiers, failure handling and testing

Status: Proposed, 18 October 2026.

## Decision
- **Monitoring:**
  - Workers Observability for logs and metrics.
  - `/v1/health`, reporting feed ages, match rates, manifest version and AI budget.
  - A scheduled GitHub Action checks `/v1/health` every 10 minutes and opens an issue and emails on breach.
  - Cloudflare Web Analytics for real-user LCP.
  - Sentry free tier for client errors.
- **Alert thresholds:**
  - RT snapshot older than 2 minutes.
  - Manifest older than 36 hours.
  - Rail match rate under 90% (bus under 80%), or ambiguity over 5%.
  - RT freshness p95 over 40 s.
  - Monthly Workers spend projected over $20.
  - AI budget over 80%.
- **Failure behaviour:**
  - Stale RT is labelled. After 5 minutes it falls back to SCHEDULED with a banner.
  - A corrupt static feed leaves the manifest unflipped, and the 7-day lookahead built from the last valid feed covers the gap.
  - A suspicious but plausible feed is quarantined with a one-click promote.
  - A broken alarm chain is re-armed by the 1-minute cron watchdog.
  - A static/RT generation mismatch serves scheduled-only rows until the hub reloads.
  - Offline PWA shows saved stops.
  - AI over budget or down means deterministic answers only.
- **Testing:**
  - Golden fixtures (three places per mode).
  - Recorded GTFS-RT fixtures.
  - zod contract tests.
  - Playwright smoke tests.
  - Lighthouse CI budget: LCP ≤ 1.5 s on slow 4G, JS ≤ 90 KB gz.
  - A shadow diff against the legacy ferry output during migration.
- **Review:** production-bound code gets a cross-model review before its PR, per AGENTS.md. Codex reviews Claude, Claude reviews Codex, and Gemini via `agy` is the fallback. Reviewer, model, commit and outcome are recorded on the PR.

## Consequences
- $0 in monitoring cost.
- The main remaining blind spot is TransLink-side data quality. Match-rate metrics are the proxy for it.
