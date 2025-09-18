# Schedule Artifact Map

| Purpose | Branch Source | Workflow | Output Path | Notes |
|---------|---------------|----------|-------------|-------|
| Production ferry schedule | `main` | `Update Ferry Schedule` | `schedule-data/latest.json` | Current brisbaneferry.com deployment. Do not modify without release approval. |
| Multi-mode dev schedules | `transit-foundation` (and feature branches) | `Update Transit Schedule (Dev)` | `schedule-data-dev/<mode>/latest.json` (artifact) | Used for Vercel preview builds and multi-mode testing. Set `VITE_TRANSIT_ENV=dev` and optionally `VITE_TRANSIT_DEV_BASE` to point clients at these files. |

## Usage
1. Trigger the **Update Transit Schedule (Dev)** workflow via GitHub Actions.
2. Select modes (`ferry train bus`). Default runs ferry + train.
3. Download the generated `transit-schedule-dev` artifact.
4. Host JSON on a temporary CDN (e.g. Vercel blob) or drop into `public/schedule-data-dev/` locally for testing.

## Guardrails
- Never commit generated JSON under `schedule-data-dev/` or `schedule-data/<mode>/` in long-lived branches.
- Keep the production workflow untouched until we deliberately migrate brisbaneferry.com to the new pipeline.
- Update this table if new environments or workflows are added.

_Last updated: 2025-01-16_
