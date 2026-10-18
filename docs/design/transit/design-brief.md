# Brief: front-end design concepts for Brisbane Train, Brisbane Bus and a multimodal app

You are a Claude Code design agent in herdr pane `wN:p1` (workspace `wN` "bris-transit-design").
Working folder: `~/Dev_local/BrisFerry/bft-transit-design` (git worktree of brisbane-ferry-tracker, local branch `design/transit-concepts` from develop). This is DESIGN ONLY.

## Tool: the /design skill
Use Claude Code's `/design` skill (research preview, v2.1.234+): it drafts editable UI artboards from a brief and publishes a canvas, printing a link. Use `/design-sync` first if available to sync the ferry app's design system from this repo (Tailwind config, `src/components`) so the family feels related. If /design-sync fails or isn't available, carry on without it and note why.
Run one `/design` session per product (three canvases), each with 2-3 distinct visual directions. Do NOT pick a direction or implement anything: Brett will choose from the canvases.

## Context (read first)
- The live ferry app: www.brisbaneferry.com. Code is in this worktree (`src/`, `AGENTS.md`). It shows live departures between two Brisbane ferry terminals, with a live vessel map, ferry detail, an All/Express filter, nearest stop and an iOS app with a widget. Commuter-first: open it, see the next departures in under 2 seconds.
- Prior attempt and learnings: `~/Dev_local/BrisFerry/docs/archive/mode-abstraction-v2-learnings.md`, `docs/brisbanetransit-plan.md`, `docs/brisbane-x.com-expansion.md`. Skim them for intent and scale; ignore their architecture.
- Decision (Apr 2026): Train and Bus are standalone apps (brisbanetrain.com, brisbanebus.com), sibling brands to the ferry app. Also explore a multimodal "Brisbane Transit" combination, as a concept for Brett to compare.
- Data: TransLink SEQ GTFS + GTFS-RT (live trip updates, vehicle positions, alerts).
  - Train: about 154 stations and 363 platforms, lines with official colours, platform numbers, only reachable destinations shown.
  - Bus: about 12k stops and 460+ routes. Users pick by search (name or stop number) and nearby stops, not long dropdowns. A full-network live map isn't realistic; a per-route or per-stop map is fine.

## Deliverables (screens, mobile-first; show one desktop layout per direction)
For each product cover: home/origin-destination or stop picker; departures list (live vs scheduled, delays, cancellations, platform/stop, express/all-stops); service detail (stopping pattern, live position, occupancy if available); live map; nearby stops (location); search; saved/favourite trips or stops; service alerts; loading, empty, offline and error states; an iOS Home Screen widget.
- Train: line colours, platform changes, reachable destinations.
- Bus: route numbers as the main identifier, stop search by name or number, "my stops", realtime countdown.
- Multimodal: how mode switching works (tabs vs unified journey vs nearby-everything), and how ferry, train and bus coexist visually while still matching the standalone brands.
Accessibility: WCAG AA contrast, large tap targets, works one-handed, dark mode.

## Rules
- No code changes to the app, no commits pushed, no PRs, no deploys, no Discord/Linear posts. Local files only.
- Never read .env or secret files.
- Don't touch other herdr panes or workspaces.

## Finish
Write `~/Dev_local/BrisFerry/bft-transit-design-report.md`:
- Each canvas link, with a one-paragraph summary of each direction.
- Your recommendation.
- Open questions for Brett.
- Any /design or /design-sync issues.
End the report with a line `JOB-COMPLETE`. Leave this pane open with the session idle, so Brett can keep iterating on the canvases with you; Dev will close it later.
