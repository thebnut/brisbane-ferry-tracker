# Brisbane Train, Bus and Transit: design concepts report

Date: 18 October 2026. Design only: no app code changed, nothing committed or pushed. Working branch `design/transit-concepts` is untouched.

All three canvases are private until shared from each page's Share menu.

## Canvases

| Product | Canvas | Directions | Artboards |
|---|---|---|---|
| Brisbane Train | https://claude.ai/artifact/FfbrXo74pRoSYhUoCxtHyc | 3 | 27 |
| Brisbane Bus | https://claude.ai/artifact/ScHAyk4XDB1ZqpYtRy1NUm | 2 | 18 |
| Brisbane Transit (multimodal) | https://claude.ai/artifact/7s93w3AhL4fSTdz1Ch9Yqy | 3 | 27 |

Each direction has the same nine boards, laid out in two rows:
1. Home, with saved trips or stops and a nearby summary.
2. Search or picker.
3. Departures.
4. Service detail: stopping pattern, live position, occupancy.
5. Live map.
6. Service alerts.
7. A states board: loading, empty, offline and error.
8. Dark mode plus iOS Home Screen widgets, small and medium, light and dark.
9. A fluid desktop page.

### Family rules shared by every canvas

These keep the brands visibly related:
- **Fixed mode colours:** ferry sunset orange `#FF6B35`, from the live app's Tailwind config; train jacaranda violet `#5B3FD1`; bus wattle gold `#F2B705`, always with charcoal text on it.
- **One wordmark lockup:** "Brisbane" plus the mode word in bold, in its mode colour.
- **One status vocabulary:** LIVE (with a GPS glyph when position is known), SCHEDULED, "+n min late", CANCELLED, PLATFORM CHANGED, Express / All stops.
- **One countdown rule:** "Now / n min", switching to clock time beyond 60 minutes, with a date tag for tomorrow's services.
- **One-handed use:** controls sit in the bottom third, with tap targets of 48 px or more.
- **Status never by colour alone:** every status has a label.

## Brisbane Train

**A · Ferry Sibling** (Plus Jakarta Sans). The live ferry app redrawn: cream ground, rounded white cards, pill countdown chips, with violet instead of orange.
- **Line and platform:** line colour is a slim bar on each departure; platform is a violet-tint chip; a platform change is an amber chip with the old number struck through. Bottom tab bar.
- **Strengths:** obviously the same company, the gentlest learning curve, and the cheapest to build from existing ferry components.
- **Weaknesses:** the least distinctive. Line colour and platform are small details, so they read less strongly at a glance.

**B · Platform Board** (Barlow Condensed and JetBrains Mono). Borrows from station signage.
- **Look:** a charcoal header band, uppercase condensed type, 56 px square platform tiles (amber "NOW 7" on a platform change), big monospaced countdowns, line pills, and a dark schematic map.
- **Strengths:** the most glanceable at arm's length, with the platform in the strongest position. Best dark mode and widgets of the set.
- **Weaknesses:** dense and austere, the furthest from the ferry app's warmth. Long uppercase lists are tiring to read.

**C · Line First** (Figtree and IBM Plex Mono). Built around the network diagram.
- **Stopping patterns:** every departure carries a metro-map strip, with filled dots for stops and hollow dots for stations an express skips.
- **Other screens:** the picker shows only reachable stations, grouped by line. Detail is a vertical line with a moving train capsule. Alerts become a line-status board.
- **Strengths:** express versus all stops is visible without reading, and it scales to the full network.
- **Weaknesses:** the strips take vertical space, so fewer departures fit per screen. It depends on accurate stopping-pattern data and on a final line palette.

## Brisbane Bus

**A · Ferry Sibling** (Plus Jakarta Sans). The bus version of the ferry app, in gold with charcoal text.
- **Home:** "My stops" as stacked cards, each with that stop's next three routes, plus a "stops near you" card.
- **Countdown chips:** charcoal for Now, gold for soon, pale gold for later.
- **Other screens:**
  - Search shows busway platform letters and stop numbers.
  - The departures list shows a delay, a cancellation and a detour banner.
  - Route detail has a vertical stopping pattern and an occupancy meter.
  - The map is per route, with a bottom sheet.
- **Strengths:** reads instantly as a sibling, and it's friendly, with generous status and occupancy display.
- **Weaknesses:** lower density, about 6–7 departures per screen. Gold chips can read as a warning.

**B · Kerbside** (Barlow Condensed and Barlow). The route number is the hero: charcoal tiles with gold numerals, like a bus destination blind.
- **Countdowns:** huge, condensed and right-aligned.
- **Home:** search-first. "My stops · next bus" sits at the top, and a dark bottom sheet holds nearby stops plus a "Stop name or number" field at thumb height. Results stack upward toward the thumb.
- **Detail and map:** detail has a blind-style "66 UQ LAKES" header. The map is per stop, showing the buses heading to your platform.
- **Desktop:** looks like a station departure board.
- **Strengths:** the fastest answer to "which bus is next", the best one-handed flow, and the most distinctive look.
- **Weaknesses:** further from the ferry family. Heavy charcoal can feel severe in daylight, and condensed type needs care at small sizes.

## Brisbane Transit (multimodal)

Each direction tests a different way of switching modes.

**A · Mode Tabs** (Figtree). A bottom tab bar: Ferry | Train | Bus | Saved.
- **How it works:** each tab is the standalone app in its own colour, with its own wordmark. Ferry has the All/Express filter, Train has the platform-change banner, and Bus has stop search with a per-route map. Saved is the commuter home, mixing all three modes.
- **Strengths:** the closest to the standalone brands, the easiest to learn, and screens map almost one-for-one onto the three apps.
- **Weaknesses:** no cross-mode journeys, and "nearby" is only a link.
- **Build cost:** lowest, essentially a shell around the standalone apps.

**B · Unified Journey** (Instrument Sans, neutral greys). One "Where to?" planner.
- **Results:** journeys drawn as segmented bars, sized by duration, with a colour per mode and dotted walking legs (for example bus 199 then CityCat F1).
- **Saved trips and alerts:** saved trips mix modes and show "Leave in n min". A cancelled leg strikes out the whole option. Alerts are grouped by saved journey, with their effect on arrival time.
- **Strengths:** the best for trips that need more than one mode, and the cleanest look.
- **Weaknesses:** the standalone brands are least visible.
- **Build cost:** highest. It needs a trip planner (OpenTripPlanner or similar) plus GTFS-RT matching across modes, several times the work of the standalone apps.

**C · Nearby Everything** (Atkinson Hyperlegible, warm off-white, high contrast). Location first.
- **Home:** "Around you" groups every stop within walking distance under a band in its mode colour, with filter chips per mode.
- **Leaving soon:** a merged list with walk-time cues ("Hurry", "Too late").
- **Map and alerts:** map pins differ in both shape and colour: ferry circle, train square, bus diamond. Alerts are sorted by distance.
- **Strengths:** the best answer to "what can I catch right now", with the strongest accessibility of the set.
- **Weaknesses:** weaker for fixed commutes unless the user saves stops, and it depends on location permission.
- **Build cost:** medium. It needs a nearby-stops index across all 12k+ stops and merged live feeds, but no trip planner.

## Recommendation

- **Standalone apps:**
  - **Train:** Ferry Sibling (Train A) as the base, borrowing two things from the other directions: Line First's stopping-pattern strip, in the departure row or at least in service detail, and Platform Board's large platform tile with the amber "NOW n" platform-change treatment. That keeps the family resemblance and the cheapest build path from the ferry components, and fixes A's weakness: platform and line read too weakly at a glance.
  - **Bus:** Kerbside (Bus B) for the departures list and detail, where route-number-first is clearly faster. Keep it in the family by using the ferry app's light ground and rounded cards for home and search, and save the charcoal "blind" tile for the route number itself.
- **Multimodal:** Mode Tabs (Transit A) if a combined app is built soon, because it is mostly a shell around the standalone apps and protects their brands. Add Nearby Everything's "Around you" screen as a fifth tab later. Leave Unified Journey as a long-term concept: it needs a trip planner and cross-mode matching, which is a separate product.
- **Before building:** fix the line palette and the stopping-pattern data contract (see the learnings doc's "define the query contract first" lesson).

## Open questions for Brett

1. **Brand colours:** are jacaranda violet (train) and wattle gold (bus) the right mode colours? Gold sits close to warning colours, and violet has to coexist with the real line colours.
2. **Line colours:** should the train app use the official line colours from GTFS `route_color` (the canvases use placeholders), or a palette of our own tuned for contrast?
3. **Family closeness:** how close should the siblings stay to the ferry app? Should the ferry app itself be refreshed to match a newer direction (Platform Board, Kerbside) instead?
4. **Bus home:** should it open on "My stops" (Bus A) or be search-first with nearby stops (Bus B)? This decides whether location permission is asked on first open.
5. **Multimodal scope:** is it a fourth product (brisbanetransit domain) or a mode inside one of the existing apps? Is a trip planner in scope at all?
6. **Widgets:** fixed saved trip or stop, or "nearest stop" (needs background location)? Is a lock-screen or Live Activity countdown wanted for the next departure?
7. **Occupancy:** how much space should it get, given how patchy GTFS-RT occupancy is for train and bus?
8. **Desktop:** is the desktop layout worth investing in, or is mobile web plus iOS enough?

## /design and /design-sync notes

- **/design-sync wasn't run.** It isn't listed as a skill in this session, and its underlying sync tool is meant only for a user-started /design-sync to push a component library to a claude.ai design-system project. No design-system project exists for this account, so none was attached.
- **Ferry family carried by hand:** I read `tailwind.config.js`, `src/index.css` and `src/components/DepartureItem.jsx` and encoded the ferry colours and card and countdown-chip patterns in a shared family spec that all three canvases followed.
- **Possible follow-up:** you can run /design-sync yourself to turn the ferry app into a design system for future canvases. Standalone Claude Design (claude.ai/design) closes on 14 December 2026.
- **Build method:** the three canvases were built in parallel by three sub-agents from that spec.
- **Refused first publish (Train canvas):** "You haven't viewed the latest version". A read of the freshly created canvas fixed it. There were no other publish failures.
- **No visual check:** the Design type's instructions say not to render or screenshot boards unless asked, so expect small layout nits. Ask me to review any board.
- **Editor version:** the canvases are pinned to editor version 0.2.47 (0.2.85 is the newest). I left them unchanged.
- **Sample data is illustrative:** times, platforms, stop numbers, bus IDs, occupancy, and train line colours (all placeholders).

## Round 2: ferry look and logo style (18 October 2026)

Brett's feedback: keep the modern design elements, but copy brisbaneferry.com's look, feel and logo style.

**Canvas:** https://claude.ai/artifact/1ra2iuys2FPAwGNeQfYrw8. It has four pages:
- **Brand:** the logo lockups, app icons, colour, type and components.
- **Train, Bus and Transit:** nine boards each.

**What changed from round 1:**
- **Colour:** the violet (train) and gold (bus) mode colours are dropped. Every product uses the ferry app's own palette from `tailwind.config.js` and `index.css`: ferry orange, peach, aqua and light blue, plus the logo's teal `#2A9A9E` and orange `#FE8E22`.
- **Type:** the per-direction fonts are dropped in favour of the app's Inter. Poppins is used only for the wordmark.
- **Surfaces and components:** gradient page ground, gradient header with the Settings and glowing LIVE pills, white cards, an orange-glow highlight card, and the ferry countdown chip colours.
- **Logo style:** the real BrisbaneFerry lockup is used as-is. Train, Bus and Transit get new emblems in the same structure: an open teal ring, a line-art vehicle drawn at the same tilt, orange accents (a pantograph on the train, a destination blind on the bus, a pin dot for transit) and filled teal wave swooshes. Each sits beside a two-line wordmark: "Brisbane___" in teal over "Departure Boards" in orange. App icons put the emblem on the ferry icon's peach.
- **Telling modes apart:** the emblem, the mode word and a pictogram identify the mode, not a new colour. In multimodal views, pins differ by shape: ferry circle, train square, bus diamond.

**Modern elements kept, restyled in the ferry look:**
- **Train:** platform tiles with an orange "NOW 7" tile for a platform change; stopping-pattern strips; a picker that shows only reachable stations; a line-status alerts board.
- **Bus:** teal route tiles, with orange for Metro and CityGlider; a big countdown; the "Stop name or number" search in a bottom sheet at thumb height.
- **Transit:** a Mode Tabs shell (Ferry | Train | Bus | Nearby | Saved) where each tab shows its own product's lockup.

**Accessibility tweaks to the ferry palette:** these were needed to reach WCAG AA, and they also apply if the live ferry app is updated.
- Teal text darkened to `#1E7C80`.
- Aqua headings darkened to `#007C99`.
- White text on orange only in large bold chips, on `#E55A2B`.

**Open questions for round 2:**
1. **Emblems:** are the Train, Bus and Transit emblems acceptable as concepts, or should a designer redraw all four as a matched set? The ferry emblem is a raster image, and the new ones are hand-drawn SVG.
2. **Mode colour:** keep a single shared palette for all apps, as now, or add a small mode tint?
3. **Ferry app contrast:** should the live ferry app adopt the AA contrast fixes above?

**Tool note:** three sub-agents publishing to one canvas at the same time caused repeated "haven't viewed the latest version" refusals. Each publish only went through after a full read of the canvas. All boards still published. Next time, use one canvas per builder, or build sequentially.

JOB-COMPLETE
