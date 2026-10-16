# Archived design notes

Historical documents kept for context. Nothing here describes current behaviour; see `AGENTS.md` at the repo root for the live project guide.

| File | What it was | Why archived |
|------|-------------|--------------|
| `stop-selector-status-2025.md` | Status note from the dynamic stop selector build (mid 2025, formerly `latest.md`) | Feature shipped; the "current issues on Vercel" it lists were resolved |
| `stop-selector-implementation-plan.md` | Implementation plan for the same feature | Shipped |
| `multi-mode-branching-strategy.md` | Plan for train/bus expansion on `transit-foundation` and friends | Work stalled in September 2025; branches archived as `archive/*` tags in October 2026 |
| `schedule-artifacts.md` | Artifact map for the multi-mode dev schedule workflow | That workflow (`update-transit-schedule-dev.yml`) relied on a `--mode` flag the `main` processor never gained; removed in October 2026 |
