# Production cutover runbook: Brisbane Ferry to Cloudflare

Status: prepared 18 Oct 2026 (Phase 2 data cutover and Phase 3 hosting move, `transit-architecture.md` §7).
Approvals (Brett, 18 Oct, via Dev): production deploys and merges to `main`, the DNS move, Workers Paid. Conditions:
- every change goes PR → develop with a recorded Codex review
- release develop → main via a release PR, only after workers.dev staging is verified end to end
- the ferry production cutover sits behind a flag with an instant rollback
- **the current Vercel production keeps serving until the Cloudflare path is verified**
- no deletes without Brett's OK
- no weakening of security controls

Every step lists a **check**, a **rollback** and the **report entry** to add (`~/Dev_local/BrisFerry/bft-transit-build-report.md`, "Prod / shared-branch actions log").

## 0. Preconditions (staging, end to end)
- [ ] All transit PRs merged to develop: #44, #45, #48, #49, #47, #51, #46, #50, and this one.
- [ ] Staging is healthy for 24 h: `https://bft-api.brisbanetransit.workers.dev/v1/health` shows `ok: true` and RT age < 60 s. The nightly shadow diff shows 0 differences. `/v1/ask/status` shows the ledger within its cap.
- [ ] Staging apps (`bft-ferry`, `bft-train`, `bft-bus`, `bft-transit`) render live data, and their Playwright smokes pass against staging.
- [ ] Old-iOS paths on staging: `GET bft-ferry…/api/gtfs-proxy?endpoint=TripUpdates` returns protobuf with CORS for `capacitor://localhost`.
- [ ] Secrets inventory, names only (never print values):
  - `bft-api-prod`: `TURNSTILE_SECRET` and `IP_HASH_SALT`, set server-side through the Cloudflare API exactly as for staging. `ANTHROPIC_API_KEY` only when AI moves to prod (step 6).
  - `bft-ferry-prod`: `N8N_WEBHOOK_URL` and `N8N_AUTH_TOKEN`, copied by Dev from Vercel's production env.

## 1. Release PR develop → main
- Open `release: transit platform` (develop → main). Body: what changes in prod. That's nothing user-visible:
  - the legacy app's `/v1` flag defaults OFF
  - CSP adds the API host
  - new workflows: `transit-static.yml` (daily R2 publish) and `transit-shadow-diff.yml`
  - `update-schedule.yml` (the daily `latest.json` commit) is **unchanged**
- **Check:** Vercel production deploys from main and is green. The site behaves as before (spot-check the boards, the map, a terminal page, and the iOS app against prod).
- **Rollback:** revert the release merge on main; Vercel redeploys.

## 2. Production API: `bft-api-prod` on `api.brisbaneferry.com`
- From `main`: `pnpm --filter @bft/edge deploy:production`. Wrangler creates the Worker custom domain `api.brisbaneferry.com` (a new hostname; no existing record changes). The prod hub writes canonical `rt/…` keys, and staging uses `rt-staging/…` (`RT_R2_PREFIX`).
- Set the secrets (step 0). AI stays **off** in prod.
- **Check:**
  - `/v1/health` is ok
  - `/v1/ferry/stops/317584/departures?to=317590` is live
  - CORS from `https://www.brisbaneferry.com`
  - `/api/gtfs-proxy?endpoint=TripUpdates` returns protobuf
  - `/schedule-data/latest.json` matches the GitHub Pages file
  - TransLink requests ≤ 13k/day across both hubs (staging + prod = about 26k/day; drop staging to `RT_MODES=ferry,train` if needed)
- **Rollback:** `wrangler rollback --env production`, or detach the custom domain (Brett's OK: that's a delete). Nothing user-facing depends on it yet.

## 3. Phase 2: the legacy ferry app reads `/v1` (flagged, 10% → 50% → 100%)
- Vercel production env: `VITE_TRANSIT_API_BASE=https://api.brisbaneferry.com`, then `VITE_FERRY_V1_PERCENT=10`, and redeploy.
- Watch for 24–48 h:
  - client errors and `/v1` fallbacks (fallback to the legacy path is automatic on any failure)
  - departures parity (nightly shadow diff)
  - field LCP
- Then 50, then 100.
- **Rollback (instant):** set `VITE_FERRY_V1_PERCENT=0` and redeploy (about 1 min). Users already on `/v1` fall back automatically if the API errors.
- Old iOS builds are unaffected: they still use GitHub Pages `latest.json` and `www.brisbaneferry.com/api/gtfs-proxy` (Vercel).

## 4. New ferry app: `bft-ferry-prod` on `next.brisbaneferry.com`
- From `main`: `pnpm --filter @bft/ferry deploy:production`. Its custom domain is a new hostname.
- **Check:**
  - Lighthouse mobile slow 4G (LCP target ≤ 1.5 s, measure and record)
  - SSR terminal pages: `/terminal/*` URLs, canonicals and `sitemap.xml` identical to the live site (diff the URL lists)
  - PWA install and offline
  - the legacy endpoints `/api/gtfs-proxy` and `/api/feedback` (submit one real test feedback and confirm it arrives in n8n)
  - Playwright smoke against `next.brisbaneferry.com`
- **Known parity gap:** the new app has no feedback modal yet. The endpoint is served for the legacy app and iOS. Add the modal before step 5, or accept it.
- **Rollback:** `wrangler rollback`. Only `next.` is affected.

## 5. DNS cutover: brisbaneferry.com and www → `bft-ferry-prod`
- **Before:** export the exact current DNS records for `brisbaneferry.com` and `www` (the Vercel targets) into this report. That export is the rollback.
- Add `brisbaneferry.com` and `www.brisbaneferry.com` as Worker custom domains on `bft-ferry-prod`. This replaces the Vercel records, and replacing records needs Brett's OK at execution time per the delete rule. Keep the Vercel project and deployment alive for **30 days**.
- `ferry.lifemap.au`: the zone is on Cloudflare; decide separately (it can stay on Vercel).
- **Check:**
  - all the step 4 checks on the apex and www
  - an **old iOS build** against `www.brisbaneferry.com/api/gtfs-proxy`, plus GitHub Pages `latest.json` still served
  - Search Console with no coverage drop over a week
- **Rollback drill (do it once, immediately after):** restore the saved Vercel records, confirm Vercel serves, then cut back.
- **Rollback:** restore the saved DNS records (minutes; TTL kept low during the window).

## 6. AI in production (optional, after step 5)
- One US$10/month cap across environments: set staging `AI_ENABLED=false` first, then prod `AI_ENABLED=true` with `AI_MONTHLY_BUDGET_USD=10`. Set `ANTHROPIC_API_KEY` on `bft-api-prod` (Dev).
- **Check:** `/v1/ask/status` on prod; a person asks 2–3 questions in a real browser.
- **Rollback:** `AI_ENABLED=false` and redeploy.

## 7. Afterwards
- Phase 1 freshness target (p95 ≤ 40 s): enable the shared per-PoP snapshot refresh (Cache API works on the custom domain), re-measure under real traffic, consider a 10 s hub cadence.
- Stop the daily `latest.json` commit job only after old iOS adoption allows it (open question 3: "indefinitely" for now). Publishing `latest.json` from the Actions Pages artifact is Phase 2's last step and needs Brett's OK (it changes GitHub Pages).
- Train and bus production (brisbanetrain.com, brisbanebus.com): repeat steps 4–5 per app.
