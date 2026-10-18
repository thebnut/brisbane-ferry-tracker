# ADR-0005: Frontend on Vite 8, React 19 and React Router 8 framework mode (prerender + SPA)

Status: Proposed, 18 October 2026. Revised after the Codex review (finding 12).

## Context
- The ferry app is Vite 8 + React 19 + Tailwind 3 + Leaflet/MapLibre. A postbuild script emits static `/terminal` SEO pages.
- Targets: departures in under 1.5 s on 4G, SEO pages for stations and stops, an offline PWA, and Capacitor iOS with widgets.

## Decision
- **Base:** Vite 8.3 and React 19.3.
- **Routing:** React Router 8.4 in framework mode, running in the API Worker.
  - Stop, station and terminal routes are **server-rendered with live departure rows in the HTML**, plus matching hydration state. This is a deliberate server runtime.
  - Static pages are prerendered.
  - Navigation is SPA after hydration.
  - JS, CSS and other static files come from a separate assets-only Worker, so they stay free and unmetered.
- **Styling:** Tailwind 4.3, with one shared preset carrying the mode colours.
- **Map:** MapLibre GL 6.14 on OpenFreeMap tiles, without Leaflet, lazy-loaded.
- **Data and offline:** TanStack Query 5 for polling and offline persistence, and vite-plugin-pwa 2.0.
- **Native:** Capacitor 8.5, with WidgetKit and App Intents.
- **Tooling:** TypeScript 7 in packages, Biome 2.5, Vitest 5, Playwright 1.64, Lighthouse CI.
- **Performance budget:** JS ≤ 90 KB gz on first load, and JS does not block LCP because the rows are in the HTML. Map code is never on the LCP path.
- **1.5 s LCP is an acceptance target**, measured cold and warm on a mid-range Android in Phase 3.

## Alternatives
- **TanStack Start 1.169:** a strong runner-up, with type-safe routes, but SSR-first and younger.
- **Next 16.4:** RSC and server weight, and it pulls the project toward Vercel.
- **Astro 7.4:** islands are great for content but awkward for an app this interactive.
- **SolidStart 2:** a full rewrite.
- **Staying on a plain SPA with a postbuild script:** works for 22 terminals, but not for 12k bus stop pages.

## Consequences
- Moving the ferry app is mostly mechanical: routes plus Tailwind 4.
- SSR page views are metered Worker requests, and the cost model in §6 includes them.
- 12k bus stop pages need no prerender build step.
