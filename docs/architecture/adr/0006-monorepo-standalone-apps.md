# ADR-0006: pnpm + Turborepo monorepo with standalone, build-time-mode apps

Status: Proposed, 18 October 2026.

## Context
- The April 2026 decision (BRI-6) shelved runtime mode switching (`ModeProvider`, hostname detection) after `mode-abstraction-v2` failed. The failure came from scope creep, context-identity render loops, and a branch too big to merge.
- Three or four products still share most of their logic.

## Decision
- **One monorepo:** pnpm workspaces with Turborepo 2.11.
  - `apps/{ferry,train,bus}`, with `apps/transit` later.
  - `packages/{core,ui,config}`.
  - `services/edge` and `pipeline/`.
- **Each app is standalone:** its own domain, brand, bundle and iOS app, with the mode fixed at build time.
- **Shared code lives only in packages.**
- **Multimodal is a fourth thin app**, the Mode Tabs design, composed from the packages.
- **Convert this repo in place** if Brett agrees (open question 4).
- **Branch rule:** no foundational branch lives longer than 2 weeks.

## Alternatives
- **Separate repos:** triple maintenance of core and contract drift.
- **A runtime multi-mode app:** already tried and rejected.
- **Nx:** heavier than this project needs.

## Consequences
- There is one shared edge service and poller for all apps.
- CI builds only affected apps (Turborepo).
