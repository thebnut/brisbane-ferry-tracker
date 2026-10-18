# ADR-0001: Host apps and API on Cloudflare Workers

Status: Proposed, 18 October 2026. Revised after the Codex review (findings 9, 10).

## Context
- The ferry app runs on Vercel Hobby. Hobby has hard caps (about 1M edge requests and 100 GB transfer a month), is for non-commercial use only, and allows cron once a day.
- Train and bus multiply the traffic. A per-user GTFS-RT proxy grows in cost with users.
- Brett pays for this himself, so cost has to stay close to $0.

## Decision
- Serve each app's static files from an **assets-only Worker**. Static asset requests and bandwidth are free and unlimited there.
- Serve SSR stop pages and the `/v1` API from **one API Worker**, using Hono 4.13 and React Router 8, built with wrangler 4.151 and `@cloudflare/vite-plugin` 1.64. These requests are metered. The Durable Objects (ADR-0003, ADR-0008) and R2 (ADR-0002) live beside it.
- Benchmark Workers Cache for the API Worker only, so static files stay unmetered.
- Start on Workers Free. Move to **Workers Paid ($5/month)** when Phase 0 shows the poller or SSR needs more CPU than Free allows, or at about 3k DAU, where Free's 100k requests/day runs out in the base usage model.

## Alternatives
- **Vercel Pro:** $20/month plus metered edge requests (including static files) and function time.
  - Running the same shared-poller design there would cost about $330 or more a month at 100k DAU, against about $37 on Cloudflare.
  - It also needs an outside sub-minute poller.
- **Netlify:** similar metering, and no Durable Object equivalent.
- **Fly.io:** cheap VMs, but no free CDN or static tier and egress is billed.
- **GitHub Pages:** no API and no custom headers.

## Consequences
- Brett's domains need Cloudflare zones (open question 1).
- Vercel Analytics and Speed Insights go. Cloudflare Web Analytics replaces them.
- Vendor concentration risk. The mitigation is portable Hono code and plain-file data.
