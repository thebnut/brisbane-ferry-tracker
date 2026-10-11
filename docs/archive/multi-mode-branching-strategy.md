# Multi-Mode Expansion Branching Strategy

## Goals
- Keep the ferry production experience (branch `main`, schedule workflow, CDN paths) frozen until we deliberately cut over.
- Provide a safe integration lane for the configuration + infrastructure work already explored on `transit_dev`.
- Stage train/bus features behind feature branches so we can demo on Vercel preview deployments without polluting prod assets.

## Branch Roles
- **`main`** — Production. Only receives hotfixes or verified ferry improvements. Uses existing `Update Ferry Schedule` GitHub Action and `/schedule-data/latest.json` artifact.
- **`develop`** — Stable ferry branch. Pre-merge staging for ferry-only changes; source for new multi-mode branches once the foundation is ready.
- **`transit-foundation`** — New long-lived branch created from `develop`. Houses mode abstraction, serverless cache plumbing, and schedule-processor refactors that do *not* change ferry behaviour or workflows.
- **Feature branches** — Short-lived branches targeting `transit-foundation` (e.g. `train-mode-ui`, `train-gtfs-rt`, `bus-backend`). Each should ship an incremental slice and rely on Vercel preview builds for validation.
- **`transit_dev` (legacy)** — Reference only. We will cherry-pick from it but avoid merging due to generated artefacts and regressions.

## Cherry-Pick Plan (into `transit-foundation`)
Focus on the safe architectural commits:
1. **Mode scaffolding** — `cefa223` (ModeProvider & config directory) plus follow-up fixes (`d3f408b`, `1cfc9ad`).
2. **Serverless cache base** — `7367615`, `adbf460`, `7397895`, `1d4d9d3` (ensure regressions fixed before landing).
3. **Schedule processor multi-mode support** — `a0ac0324`, `aac0324` (strip out train JSON artefacts before commit).
4. **Config-aware component tweaks** — selective hunks from `a85307a` only where they fall back gracefully to ferry defaults.

Each cherry-pick should be rebased interactively to drop references to the large generated JSON files and to keep commit history clean.

## Schedule Data Handling
- Leave the existing GitHub Action untouched. `main` and Vercel prod continue to reference `/schedule-data/latest.json`.
- Add a *new* workflow (`.github/workflows/update-transit-schedule-dev.yml`) on `transit-foundation` that only runs on demand or nightly, publishing mode-specific JSON to `schedule-data-dev/<mode>/latest.json`.
- Update the new static GTFS services to read from `schedule-data-dev` when `VITE_TRANSIT_ENV=dev`, falling back to production paths otherwise.
- Add a repo-level `docs/schedule-artifacts.md` to document which branches own which artefacts.

## Guardrails
- **Ban generated artefacts**: Add `schedule-data-dev/` and any `*.json` outputs from processor to `.gitignore`; keep prod snapshots under Git LFS or current workflow only.
- **Automated checks**: Extend lint/test pipeline to fail if new schedules appear in `git status`.
- **Prod safety**: Require PR approvals + automated smoke test for any PR into `main`.

## Immediate Actions
1. Create `transit-foundation` from latest `develop`.
2. Update `.gitignore` to cover `schedule-data-dev/` and processor outputs.
3. Cherry-pick ModeProvider + config scaffolding commits (with manual review).
4. Cherry-pick serverless cache + processor refactors, removing references to tracked JSON files.
5. Stand up the new workflow skeleton and document the dev CDN path.
6. Build a Vercel preview off `transit-foundation` and confirm ferry parity before enabling train work.

## Upcoming Feature Branches
- `train-mode-data`: Rework GTFS filtering + dep merging to surface train departures without UI changes.
- `train-mode-ui`: Station search, platform badges, line filters.
- `transit-cache-observability`: Metrics/logging + optional KV storage for the serverless cache.
- `bus-infra-spike`: Prototype route-pattern generation on a separate branch without touching foundation until ready.

Document updated: 2025-01-16.
