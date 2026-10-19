# Production cutover runbook: Brisbane Ferry to Cloudflare

Status: prepared 18 Oct 2026 (Phase 2 data cutover and Phase 3 hosting move, `transit-architecture.md` §7).
Approvals (Brett, 18 Oct, via Dev): production deploys and merges to `main`, the DNS move, Workers Paid. Conditions:
- every change goes PR → develop with a recorded Codex review
- release develop → main via a release PR, only after workers.dev staging is verified end to end
- the ferry production cutover sits behind a flag with an instant rollback (in practice: every new page load, while open tabs fall back on any `/v1` error; see step 3)
- **the current Vercel production keeps serving until the Cloudflare path is verified**
- no deletes without Brett's OK
- no weakening of security controls

Every step lists a **check**, a **rollback** and the **report entry** to add (`~/Dev_local/BrisFerry/bft-transit-build-report.md`, "Prod / shared-branch actions log").

**Build marker: verify every deploy (all five Workers, staging, production-preview and production).** Every Worker response (HTML, `/v1` proxy answers and errors) carries `x-bft-build: <short sha>`, and `bft-api`'s `/v1/health` also returns `"build"`. The `deploy:*` scripts compute it from the checkout with `scripts/build-sha.mjs` before building and pass it as `wrangler deploy --var BUILD_SHA:<sha>`; it gets `-dirty` when the tree has uncommitted or untracked changes, and the deploy stops outside a git checkout. Local dev and tests show `dev`. Static files (`/assets/*`, icons, `sw.js`) are answered by Workers static assets without running the Worker, so they don't carry it; check an HTML page. After **each** deploy:
```sh
git rev-parse --short=7 HEAD                    # the commit being released, e.g. 1a2b3c4
curl -sI https://<host>/ | grep -i x-bft-build   # must print exactly that sha
curl -s https://<api host>/v1/health | jq -r .build   # bft-api only: the same sha
```
A mismatch, `dev`, or a `-dirty` suffix on a production host means the wrong code went out: stop, find out why, and redeploy from a clean checkout of the release commit before continuing. Record the sha per host in the report.

## 0. Preconditions (staging, end to end)
- [ ] All transit PRs merged to develop: #44, #45, #48, #49, #47, #51, #46, #50, and this one.
- [ ] Staging is healthy for 24 h: `https://bft-api.brisbanetransit.workers.dev/v1/health` shows `ok: true` and RT age < 60 s. The nightly shadow diff shows 0 differences. `/v1/ask/status` shows the ledger within its cap.
- [ ] Staging apps (`bft-ferry`, `bft-train`, `bft-bus`, `bft-transit`) render live data, and their Playwright smokes pass against staging.
- [ ] Old-iOS paths on staging: `GET bft-ferry…/api/gtfs-proxy?endpoint=TripUpdates` returns protobuf with CORS for `capacitor://localhost`.
- [ ] Secrets inventory, names only (never print values):
  - `bft-api-prod`: `TURNSTILE_SECRET` and `IP_HASH_SALT`, set server-side through the Cloudflare API exactly as for staging. Its `TURNSTILE_SECRET` is the **PROD** widget's secret (`bft-transit-prod`, done 19 Oct); `bft-api` (staging) keeps the STAGING widget's (`bft-transit-ask`). Same name, different values (section 9). `ANTHROPIC_API_KEY` only when AI moves to prod (step 6).
  - `bft-ferry-prod` (and `bft-transit-prod` when it exists): `FEEDBACK_DISCORD_WEBHOOK_URL`, set by Dev/Brett from `apps/ferry` with `wrangler secret put FEEDBACK_DISCORD_WEBHOOK_URL --env production` (paste the value at the prompt; never on the command line). Without it `/api/feedback` answers 503.
  - `bft-transit-prod` (section 8): the same secret, because transit mounts the Ferry screens and their `/api/feedback`. Set it with `wrangler secret put FEEDBACK_DISCORD_WEBHOOK_URL --name bft-transit-prod` after 8.1 creates the Worker.
  - The legacy Vercel app: the same `FEEDBACK_DISCORD_WEBHOOK_URL` in Vercel's **production and preview** env. Set it **before** the release that carries the Discord feedback change (step 1): from that release, feedback on www.brisbaneferry.com and the iOS app returns 503 until it is set. The previous feedback webhook vars can then be removed from Vercel.
  - **Feedback Turnstile needs no new secret** (section 9). The ferry and transit Workers and the Vercel route verify tokens through `bft-api` / `bft-api-prod`, which already hold `TURNSTILE_SECRET`. Don't add `TURNSTILE_SECRET` anywhere else: only `bft-api` and `bft-api-prod` verify tokens.
  - Optional, Brett's call: a Vercel Firewall rate-limit rule on `/api/feedback`. The route's own limiter is per instance, best effort (`api/_rate-limit.js`); the Workers use the `FEEDBACK_LIMITER` binding.

- [ ] **Order for feedback Turnstile (section 9):** `bft-api-prod` must be running the code with `POST /v1/turnstile/verify` **before** the release that carries the Turnstile feedback change reaches Vercel production. Otherwise web feedback on www.brisbaneferry.com answers 503 (fail closed) until it is. The iOS app is unaffected.
- [ ] **Prod frontends must ship the PROD sitekey.** `bft-api-prod` already holds the PROD widget's secret, so a token from the STAGING widget fails siteverify there (403, fail closed). Every prod frontend must therefore be built from a commit that carries the two-widget split (`TURNSTILE_SITEKEY` per env in `apps/ferry` and `apps/transit` `wrangler.jsonc`, the PROD default in `src/utils/turnstile.js`). Until a release with it ships, a prod deploy built with the old (STAGING) sitekey fails closed on web feedback. In Vercel production, leave `VITE_TURNSTILE_SITEKEY` unset (the build defaults to the PROD key) or set it to the PROD key; never the STAGING or test key. Decide `ferry.lifemap.au` first (section 9): it isn't on the PROD widget yet.

## 1. Release PR develop → main
- Open `release: transit platform` (develop → main). Body: what changes in prod. That's nothing user-visible:
  - the legacy app's `/v1` flag defaults OFF
  - CSP adds the API host
  - new workflows: `transit-static.yml` (daily R2 publish) and `transit-shadow-diff.yml`
  - `update-schedule.yml` (the daily `latest.json` commit) is **unchanged**
- **Order, for any release that carries the feedback Turnstile change (#66) or later:**
  1. Take the release PR's **head commit**: the reviewed, smoke-tested develop SHA that the merge will bring in, say `<rc>`. Deploy `bft-api-prod` from a checkout detached at `<rc>` **first**: `git checkout --detach <rc>`, `pnpm install --frozen-lockfile`, then `pnpm --filter @bft/edge deploy:production`. (`deploy:production` deploys whatever is checked out; it doesn't pick a commit.)
  2. Check `POST https://api.brisbaneferry.com/v1/turnstile/verify` with body `{"token":"dummy"}`. It must answer HTTP 200 JSON with `success: false`, not 404. That probe can't post feedback; it uses one call of the verify rate limits.
  3. **Only then** merge the release PR (head `<rc>`) into `main`. That deploys the legacy app on Vercel prod. If main's merge commit differs from `<rc>` only by main's own `schedule-data/` commits, the `bft-api-prod` code is the same.

  In the other order, web feedback on www.brisbaneferry.com fails closed (503) until `bft-api-prod` catches up. iOS feedback is unaffected. `<rc>` must also carry the two-widget split, so the Vercel build ships the PROD sitekey that `bft-api-prod`'s secret matches (step 0, section 9). See also step 0.
- **Check:** Vercel production deploys from main and is green. The site behaves as before (spot-check the boards, the map, a terminal page, and the iOS app against prod).
- **Rollback:** revert the release merge on main; Vercel redeploys. That restores the legacy app's code only. The merge also starts two scheduled jobs on `main` that act on R2 (`bft-transit-data`, shared by staging and prod), and reverting doesn't undo what they have already done:
  - **Stop them first.** Run `gh workflow disable transit-static.yml`, then cancel any active run: `gh run list --workflow transit-static.yml --status in_progress`, then `gh run cancel <id>`. A run cancelled mid-publish leaves the previous `manifest.json` live, because the manifest is written last. The mutable `data/` and `legacy/` files may already be the new ones, so republish the previous output if that matters (below).
  - **Daily publish (03:15 AEST):** it adds a new immutable generation and switches `manifest.json` (and the mutable `data/` and `legacy/` files) to it. The previous generation stays in R2 and is still named as `previous` in the manifest. To go back:
    1. take the earlier build output: the workflow artifact `transit-static-<run id>`, kept 5 days and downloaded to an absolute path, or a local `pnpm build:data` of the earlier feed;
    2. from the `pipeline/` directory, run `pnpm publish:data --from /abs/path/to/out --target r2`. From the Mac without R2 keys, run `scripts/with-r2-uploader.sh pnpm publish:data --from /abs/path/to/out --target uploader` instead, also from `pipeline/`. That rewrites the manifest and the mutable files to the earlier generation, and its immutable content is still present.

    Quarantine is **per mode**. A quarantined mode keeps its previous live generation, and its candidate is only in `manifest.staging.json`. The other modes in the same run are published normally, along with `manifest.json` and their mutable files. So check the run's manifest and roll back every mode that went live, not just the quarantined ones.
  - **Weekly GC (Sunday run, or `gc=true`) deletes, and can't be undone:** R2 has no versioning here. Only `static/` blobs, shards and generation indexes are candidates; manifests, `data/`, `legacy/` and `rt/` are never touched. It keeps:
    - every generation the manifests name (current, previous, quarantined, staging);
    - any generation with an upload in the last 14 days;
    - every blob or shard those generations reference;
    - anything uploaded in the last 48 h.

    An **unreferenced** blob or shard can be deleted once it's older than 48 h: the 14 days apply to generations, not to orphaned objects. GC aborts above its max-fraction rail. So the current and previous generations, and any generation from the last 14 days, are always recoverable. An older generation is gone once collected. Rebuilding it needs that day's GTFS feed. To prevent further deletes, disabling the workflow (above) is enough.

## 2. Production API: `bft-api-prod` on `api.brisbaneferry.com`
- From `main`: `pnpm --filter @bft/edge deploy:production`. Wrangler creates the Worker custom domain `api.brisbaneferry.com` (a new hostname; no existing record changes). The prod hub writes canonical `rt/…` keys, and staging uses `rt-staging/…` (`RT_R2_PREFIX`).
- Set the secrets (step 0). AI stays **off** in prod.
- **Check:**
  - `x-bft-build` on `https://api.brisbaneferry.com/v1/health`, and its `build`, equal the release commit (see "Build marker" above)
  - `/v1/health` is ok
  - `/v1/ferry/stops/317584/departures?to=317590` is live
  - CORS from `https://www.brisbaneferry.com`
  - `/api/gtfs-proxy?endpoint=TripUpdates` returns protobuf
  - `/schedule-data/latest.json` matches the GitHub Pages file
  - TransLink requests ≤ 13k/day across both hubs (staging + prod = about 26k/day; drop staging to `RT_MODES=ferry,train` if needed)
- **Rollback:** `wrangler rollback --env production`, or detach the custom domain (Brett's OK: that's a delete). Nothing user-facing depends on it yet.

## 3. Phase 2: the legacy ferry app reads `/v1` (flagged, 10% → 50% → 100%)
- The legacy app's CSP (`vercel.json` and the iOS `index.html` meta) already allows `https://api.brisbaneferry.com` in `connect-src`. **Check** in a real browser that `/v1` requests succeed with no CSP violations in the console before raising the percentage.
- Vercel production env: `VITE_TRANSIT_API_BASE=https://api.brisbaneferry.com`, then `VITE_FERRY_V1_PERCENT=10`, and redeploy.
- Watch for 24–48 h:
  - client errors and `/v1` fallbacks (fallback to the legacy path is automatic on any failure)
  - departures parity (nightly shadow diff)
  - field LCP
- Then 50, then 100.
- **Rollback:** set `VITE_FERRY_V1_PERCENT=0`, make sure `VITE_FERRY_DATA_SOURCE` is unset (it forces `/v1` for everyone), and redeploy (about 1 min). It takes effect on each user's **next page load**, not instantly:
  - The data source is chosen once per page load (`src/utils/dataSource.js`). A tab that is already open keeps using `/v1` until it's reloaded. On any `/v1` error, an `rtState` other than live/stale, or an empty board, that refresh falls back to the legacy path, so an API outage degrades to legacy even before a reload.
  - A tab opened with `?dataSource=v1` stays on `/v1` for that tab (sessionStorage) whatever the percentage. Only testers use that parameter. Clear it with `?dataSource=legacy` or by closing the tab.
  - If open sessions must stop using `/v1` at once, make the API unreachable for them: detach the `api.brisbaneferry.com` custom domain (a delete, so Brett's OK). Every open page then falls back to legacy on its next refresh (the 5-minute auto-refresh or a manual Refresh).
- Old iOS builds are unaffected: they still use GitHub Pages `latest.json` and `www.brisbaneferry.com/api/gtfs-proxy` (Vercel).

## 4. New ferry app: `bft-ferry-prod` on `next.brisbaneferry.com`
- From `main`: `pnpm --filter @bft/ferry deploy:production`. Its custom domain is a new hostname.
- **Security-header gate (mandatory before step 5):** `curl -sI https://next.brisbaneferry.com/` and a static asset must show HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and on HTML a CSP with `script-src 'self' 'nonce-…'` (no `'unsafe-inline'`), `frame-ancestors 'none'` and `object-src 'none'` (`apps/ferry/workers/security.ts`, `public/_headers`). The browser console must show no CSP violations on home, a terminal page, the map and an offline reload.
- **Check:**
  - `x-bft-build` on `https://next.brisbaneferry.com/` equals the release commit (see "Build marker" above)
  - Lighthouse mobile slow 4G (LCP target ≤ 1.5 s, measure and record)
  - SSR terminal pages: `/terminal/*` URLs, canonicals and `sitemap.xml` identical to the live site (diff the URL lists)
  - PWA install and offline
  - the legacy endpoints `/api/gtfs-proxy` and `/api/feedback` (Dev/Brett: submit one real test feedback and confirm it arrives in the Discord feedback channel)
  - Playwright smoke against `next.brisbaneferry.com`
- **Feedback:** the new app has a feedback sheet (`apps/ferry/app/components/FeedbackSheet.tsx`), which posts to `/api/feedback` on its own origin (`app/lib/feedback.ts`). The same endpoint serves the legacy app and iOS. Without `FEEDBACK_DISCORD_WEBHOOK_URL` it answers 503 and the sheet shows the error, so set the secret before this check.
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
- Train, bus and transit production (brisbanetrain.com, brisbanebus.com, brisbanetransit.com): see section 8. They go straight to their real domains, with no `next.` host, and don't depend on steps 3–6. The ferry Worker's security headers and nonce CSP are already in all three apps.

## 8. Train, bus and transit production (direct on their domains)
Status: prepared 19 Oct 2026; **nothing deployed and no DNS changed**. Scope (Brett, 19 Oct): train, bus and transit go to production directly on their real domains, with no `next.` preview hostname. The conditions at the top of this runbook still apply.

| App | Worker | Step 1 host (workers.dev only) | Domains (step 4) | Canonical |
|---|---|---|---|---|
| Train | `bft-train-prod` | `bft-train-prod.brisbanetransit.workers.dev` | `brisbanetrain.com`, `www.brisbanetrain.com` | `https://brisbanetrain.com` |
| Bus | `bft-bus-prod` | `bft-bus-prod.brisbanetransit.workers.dev` | `brisbanebus.com`, `www.brisbanebus.com` | `https://brisbanebus.com` |
| Transit | `bft-transit-prod` | `bft-transit-prod.brisbanetransit.workers.dev` | `brisbanetransit.com`, `www.brisbanetransit.com` | `https://brisbanetransit.com` |

**How it's set up** (`apps/{train,bus,transit}/wrangler.jsonc`):
- **Two envs for one Worker.** `production-preview` is the Worker on its workers.dev host, with no routes. It is for 8.1 and 8.2 only: never deploy it after 8.4 (see there). `production` is the same Worker with `workers_dev: false` and the apex and www as Worker custom domains. Both use the same name, vars and bindings (transit's feedback limiter has a namespace per env); `test/wrangler-config.test.ts` checks that and fails if staging, the top level or `production-preview` ever gets a route.
- **Shared prod API.** Every env binds `API` → `bft-api-prod`, with `API_BASE=https://api.brisbaneferry.com`.
- **No fixtures or demo data.** `ALLOW_FIXTURES=0` and `FIXTURES=0`, and `FIXTURE_FALLBACK` is absent, so `/__fixtures/*` is 404 and `?fixtures=1` is ignored.
- **www → apex.** A request to `www.<apex>` gets a 301 from the Worker to the fixed `SITE_URL` origin, path and query kept (`wwwRedirectLocation` in each `workers/security.ts`). No other host is redirected, and nothing in the request can choose the target. Static files (`/assets/*`, icons, `sw.js`, the manifest) are answered by Workers static assets before the Worker runs, so on www they return 200, not a 301. That's harmless: they're the same files, and every page's canonical points at the apex. If Brett wants www fully redirected, a zone Redirect Rule does it; that's a zone change, so it's his call.
- **Soft-launch flag `INDEXABLE`.** It is `"0"` in production until step 5. While it's `"0"`, every Worker response carries `X-Robots-Tag: noindex` and `robots.txt` is `Disallow: /`; train pages also carry `<meta name="robots" content="noindex">`. Bus didn't have the flag before; it now works the same way as train. **Transit stays `"0"` for good:** its mounted mode pages are noindex, their canonical copies are the standalone apps, and its `robots.txt` always disallows.
- **Train WebSocket prototype is off.** `TRIP_WS=0`, so trips poll every 15 s. The `TripSocket` DO stays bound, with its own `v1` migration in `bft-train-prod`, so turning the prototype on later is a var change, not a migration.
- **Ask with AI off.** `bft-api-prod` has `AI_ENABLED=false`, so `/v1/ask` answers from the deterministic parser or the intent cache. Anything else gets a "Try: …" hint (`source: fallback`, `ai.enabled: false`), which the Ask box shows as a plain answer. Turnstile only matters for the LLM path. The PROD widget's hostnames list the apex and www domains, not the `bft-*-prod` workers.dev hosts, so on the step 1 host Turnstile can't pass (section 9). With AI off that changes nothing; adding hosts to the widget is Brett's call.
- **Feedback.** Transit mounts the Ferry screens, whose feedback sheet posts to `/api/feedback` on the transit origin. It needs `FEEDBACK_DISCORD_WEBHOOK_URL` on `bft-transit-prod` (step 0's inventory); the per-IP `FEEDBACK_LIMITER` binding is in both prod envs (namespaces 8107 preview, 8106 production). Without the secret the endpoint answers 503 and the sheet shows the error.
- **Security headers** are already the ferry pattern in all three apps: `workers/security.ts` with a per-request nonce CSP on HTML, and `public/_headers` for static files. HTML without its own `Cache-Control` is now `private, no-store`.
- **Always deploy with the package scripts.** A production build writes the `production` config, routes included, into `build/server/wrangler.json`. A bare `wrangler deploy` after one would deploy with the domain routes. The `deploy:*` scripts always rebuild for their env first.

**Read-only check script:** `scripts/prod-check.sh <train|bus|transit> <base URL> [--site URL] [--indexable 0|1] [--prod] [--www]`. It makes only GET requests and checks:
- key pages return 200 HTML with HSTS, nosniff, Referrer-Policy, Permissions-Policy and a nonce CSP (no `'unsafe-inline'` in `script-src`, `frame-ancestors 'none'`, `object-src 'none'`);
- HTML is `no-store`, and a hashed `/assets/*.js` file is `immutable`;
- `X-Robots-Tag` and `robots.txt` match `INDEXABLE`, and every sitemap URL sits under `--site`;
- live `/v1` calls through the app's proxy return `rtState` live or stale;
- with `--prod`, fixtures are off (`/__fixtures/*` 404, `?fixtures=1` ignored);
- with `--www`, the www → apex 301.

### 8.0 Preconditions
- [ ] A release PR carrying this change has merged to `main`, and the exact head passed:
  - Dev's smoke test on staging;
  - a recorded cross-model review;
  - green CI.
- [ ] Step 2 is done: `bft-api-prod` is healthy on `https://api.brisbaneferry.com` (`/v1/health` ok, RT age < 60 s).
- [ ] Secrets, names only: the feedback secret for `bft-transit-prod` (step 0). Train and bus need none.
- **Report:** release PR number and merge SHA; the `bft-api-prod` health line.

### 8.1 Deploy each Worker to workers.dev only (no domains)
- From `main`:
  ```sh
  pnpm --filter @bft/train deploy:production-preview
  pnpm --filter @bft/bus deploy:production-preview
  pnpm --filter @bft/transit deploy:production-preview
  ```
  This creates `bft-train-prod`, `bft-bus-prod` and `bft-transit-prod` on their workers.dev hosts. It adds no custom domain and changes no DNS record. Then set transit's feedback secret: `wrangler secret put FEEDBACK_DISCORD_WEBHOOK_URL --name bft-transit-prod`, pasting the value at the prompt (never on the command line, never printed).
- **Check:** `curl -sI https://bft-<app>-prod.brisbanetransit.workers.dev/ | grep -i x-bft-build` equals `git rev-parse --short=7 HEAD` for each app (see "Build marker" above). The deploy output lists `env.API (bft-api-prod)`, `ALLOW_FIXTURES "0"`, `FIXTURES "0"`, `INDEXABLE "0"` and no custom domains. The Worker's Domains & Routes in the dashboard shows only the workers.dev host.
- **Rollback:** `npx wrangler rollback --name bft-<app>-prod` (or `wrangler rollback --env production` from the app directory) restores the previous version. Before step 4 nothing links to these hosts, so leaving a bad version up is also safe. Deleting a Worker needs Brett's OK.
- **Report:** the version ID of each Worker.

### 8.2 Prod checks on the workers.dev hosts
- Run:
  ```sh
  scripts/prod-check.sh train https://bft-train-prod.brisbanetransit.workers.dev --site https://brisbanetrain.com --prod
  scripts/prod-check.sh bus https://bft-bus-prod.brisbanetransit.workers.dev --site https://brisbanebus.com --prod
  scripts/prod-check.sh transit https://bft-transit-prod.brisbanetransit.workers.dev --site https://brisbanetransit.com --prod
  ```
  Each must end with `ALL PASS`.
- In a real browser, the console must show no CSP violations on:
  - each home page;
  - a station or stop page;
  - the map;
  - an offline reload;
  - on transit, also an Ask question. Expect a deterministic answer or the "Try: …" hint, never an AI notice.
- Transit's Ferry-tab feedback **can't be submitted here**: the `bft-transit-prod` workers.dev host is on neither Turnstile widget, so the sheet shows the bot-check error (fail closed, by design; section 9). Test feedback on the real domain in 8.4. `prod-check.sh` doesn't exercise Turnstile.
- **Check:** the three outputs above, and the browser notes.
- **Rollback:** as 8.1.
- **Report:** paste the three `prod-check` summaries.

### 8.3 Export the existing DNS records and get Brett's OK (Brett)
The apex and www hostnames **already have DNS records**, and a Worker custom domain can't be added over an existing record. So going live means replacing those specific records. That's a DNS change and a delete, and for train it also ends a live redirect. Brett decides, at execution time.
- **Export first:** for each zone, read the apex and www records (read-only Cloudflare API: `GET /zones?name=<zone>`, then `GET /zones/<zone id>/dns_records?name=<host>`). Paste type, name, content, proxied, TTL and record ID into the report. That export is the domain-level rollback. As checked by the lead on 19 Oct (re-export on the day; these may have changed):

  | Zone | Record | Value | Proxy | Live behaviour |
  |---|---|---|---|---|
  | brisbanetrain.com | apex `A` | `216.150.1.1` (Vercel) | DNS only | 307 to https://www.brisbaneferry.com/ |
  | brisbanetrain.com | `www` `CNAME` | `…vercel-dns-017.com` | DNS only | 307 to https://www.brisbaneferry.com/ |
  | brisbanebus.com | apex and `www` `A` | `27.124.125.171` (parking) | DNS only | HTTP parking page; HTTPS fails |
  | brisbanetransit.com | apex and `www` `A` | `27.124.125.171` (parking) | DNS only | HTTP parking page; HTTPS fails |

- **Get Brett's explicit OK** to replace exactly those records: six hostnames, apex and www in three zones. Don't touch any other record in these zones (MX, TXT and so on).
- **Replace (Brett), one app at a time, train last:**
  1. Brett deletes that app's apex and www records.
  2. Run 8.4's deploy for that app straight away. Wrangler then creates the custom domains, their DNS records and certificates.

  Alternatively, Brett can add the two custom domains to the Worker in the dashboard and choose to replace the existing records; 8.4's deploy then keeps them. Between the delete and the deploy, the hostname doesn't resolve. For train, that's a few minutes without the redirect to brisbaneferry.com. Leave `brisbanetrain.com` configured in the Vercel project, so the rollback works.
- **Rollback:** remove the Worker custom domains (Brett's OK), then recreate the exported records exactly: same type, content, proxy status and TTL. Train's Vercel redirect resumes once its records are back.
- **Report:** the export, Brett's OK (time and wording), and which hostnames were replaced when.

### 8.4 Deploy with the domain routes, then re-run the checks on the real domains
- From `main`, per app, right after its records are gone or replaced:
  ```sh
  pnpm --filter @bft/<app> deploy:production
  ```
  This sets `workers_dev: false`, so the workers.dev host stops serving, and attaches the apex and www as custom domains. Wait for the certificates to issue: `curl -sI https://<apex>/` succeeds.
- Run:
  ```sh
  scripts/prod-check.sh train https://brisbanetrain.com --prod --www
  scripts/prod-check.sh bus https://brisbanebus.com --prod --www
  scripts/prod-check.sh transit https://brisbanetransit.com --prod --www
  ```
  Repeat the browser console checks from 8.2 on the real domains, and submit one test feedback from transit's Ferry tab and confirm it arrives (the PROD widget lists brisbanetransit.com and www).
- **Check:** `ALL PASS` for each, including the www → apex 301, and `x-bft-build` on each apex equals the release commit (see "Build marker" above).
- **Rollback:**
  - Worker-level: `npx wrangler rollback --name bft-<app>-prod`. The domains stay attached.
  - Domain-level: as 8.3. Restore the exported records after removing the custom domains.
- **Report:** the three summaries, and the time each domain went live.
- **Never run `deploy:production-preview` after 8.4.** It deploys to the same Worker name (`bft-<app>-prod`) as `deploy:production`, so it replaces the live version. It turns `workers_dev` back on, so the live Worker is again served on its `bft-<app>-prod.brisbanetransit.workers.dev` host. For transit it also swaps the feedback rate-limit namespace (`FEEDBACK_LIMITER` 8106 → 8107), which resets every visitor's limit. To ship a fix after go-live, use `deploy:production` from `main`. To get back to the domain setup after a mistaken preview deploy, run `deploy:production` again. A `wrangler rollback` only restores code; it may leave the workers.dev host on.

### 8.5 Flip `INDEXABLE` (train and bus)
- Once 8.4 has passed and the sites have run cleanly for at least a day, open a one-line PR. It sets `"INDEXABLE": "1"` in both `production` and `production-preview` of `apps/train/wrangler.jsonc` and `apps/bus/wrangler.jsonc`; the config test keeps the two envs identical.
- After review and release, run `deploy:production` for train and bus. Transit stays `"0"`.
- **Check:** `scripts/prod-check.sh train https://brisbanetrain.com --prod --www --indexable 1`, and the same for bus. That confirms there's no `X-Robots-Tag`, and that `robots.txt` allows crawling and names the sitemap.
- **Rollback:** `wrangler rollback --name bft-<app>-prod` returns to the noindex version at once; then revert the PR.
- **Report:** PR number, deploy version IDs, check output.

### 8.6 Search Console and sitemaps
- Add `brisbanetrain.com` and `brisbanebus.com` as Domain properties. Verification is a DNS TXT record, which is a DNS change, so Brett adds it.
- Submit the sitemaps:
  - `https://brisbanetrain.com/sitemap.xml`: home, stations, alerts and the 154 station pages;
  - `https://brisbanebus.com/sitemap.xml`: an index of pages, routes and stop sitemaps.

  Transit isn't submitted: it is noindex by design.
- `brisbanetrain.com` used to redirect to brisbaneferry.com. Expect Google to recrawl it over a few weeks; no change of address is needed.
- **Check:** both sitemaps show "Success", and coverage starts growing within a week with no spike in errors.
- **Rollback:** none needed. Removing a sitemap or property is harmless.
- **Report:** submission date and the first coverage numbers.

### 8.7 Load and budgets
- **TransLink budget: no new hubs.** All three Workers read through `bft-api-prod`, whose hub already polls the feeds for every mode. Nothing here adds TransLink requests; step 2's ≤ 13k/day per hub still applies. Don't add `RT_MODES` or a hub to these apps.
- **Watch for 24–48 h after 8.4:**
  - `bft-api-prod` `/v1/health` (RT age);
  - Workers requests per day across the account;
  - errors in each Worker's observability logs;
  - the `/v1` 502 rate (`upstream_unavailable` or `contract_mismatch`).
- **Report:** the 24 h numbers.

## 9. Feedback Turnstile (web) and the iOS path

Web feedback (the legacy modal, the ferry `FeedbackSheet` and the sheet transit mounts) sends an invisible Turnstile token. The relays (`api/feedback.js` on Vercel, `apps/ferry/workers/legacy.ts` on the Workers) refuse web posts without a valid one. The shared gate is `api/_turnstile.js`.

- **Two widgets** (split 19 Oct, Brett's decision), both invisible, action `feedback` for feedback (`ask` for the Ask box). Each `bft-api` holds only its own widget's secret, under the same name `TURNSTILE_SECRET`, so a frontend must ship the sitekey of the widget whose secret its verifying API holds:

  | Widget | Sitekey (public) | Hostnames | Secret on | Used by |
  |---|---|---|---|---|
  | **STAGING** `bft-transit-ask` | `0x4AAAAAAFZ6yPZTYH3xrIMT` | the five `bft-*.brisbanetransit.workers.dev` staging hosts; for now also the prod domains and ferry.lifemap.au (follow-up below) | `bft-api` | ferry and transit top level (dev) and `staging` |
  | **PROD** `bft-transit-prod` | `0x4AAAAAAFan8LE5_4cvR40S` | brisbaneferry.com, www, next.brisbaneferry.com, brisbanetrain.com, www, brisbanebus.com, www, brisbanetransit.com, www (9 of 10 slots) | `bft-api-prod` | ferry `production`, transit `production` and `production-preview`, the legacy Vercel build (default) |

  - `apps/ferry/test/wrangler-config.test.ts`, `apps/transit/test/wrangler-config.test.ts` and `scripts/test/turnstile-loader.test.js` pin these. localhost is on neither widget, so feedback fails closed in local dev (Playwright uses the test sitekey). Train and bus render no widget.
  - **`ferry.lifemap.au` is not on the PROD widget yet.** It serves the legacy Vercel production build (`main`), which ships the PROD sitekey from this change, so web feedback there fails closed once the release ships unless it is added. **Before the release (Brett's call, the PROD widget's 10th and last slot):** add `ferry.lifemap.au` to `bft-transit-prod`, or accept that web feedback is off on that domain (iOS and www are unaffected). That slot is the same one the `production-preview` hosts would need (below), so it's one or the other.
  - **Legacy Vercel app:** `src/utils/turnstile.js` defaults to the PROD sitekey; `VITE_TURNSTILE_SITEKEY` overrides it per Vercel env. `api/feedback.js` always verifies through `bft-api-prod` (`api.brisbaneferry.com`), whatever the deployment, so only the PROD key can pass. `brisbane-ferry-tracker.vercel.app` (the Vercel preview of `develop`) is on **neither** widget, so web feedback **fails there by design**: the widget errors and the modal says so. Brett chose to skip it (19 Oct): the split replaced the earlier options for the old widget's 10-hostname limit. The iOS app is token-less (below), unchanged.
  - **`production-preview` hosts** (`bft-*-prod.brisbanetransit.workers.dev`, section 8.1) verify through `bft-api-prod` and use the PROD sitekey for consistency, but are on **neither** widget. So Turnstile-gated features (transit's web feedback, and the Ask box's LLM path, which is off in prod anyway) **fail closed there by design**. `scripts/prod-check.sh` doesn't test Turnstile. Covering them (the PROD widget's last slot, e.g. the parent `brisbanetransit.workers.dev`) is Brett's call.
  - **Hostname check, unchanged:** the relay requires siteverify's `hostname` to equal the host the feedback was posted to. With two widgets this still holds: a secret only redeems its own widget's tokens, so a STAGING token (even one solved on a prod domain while the STAGING widget still lists it) fails at `bft-api-prod`, and a PROD token fails at `bft-api`. Within a widget, a token solved on one of its hostnames can't be spent on another.
  - **Follow-up, after prod is live on the PROD widget** (Brett's OK given): remove the prod domains and ferry.lifemap.au from the STAGING widget. Optionally replace its five staging hosts with `brisbanetransit.workers.dev`. Both are dashboard changes, not code.
- **Verification, no new secret:** the relays call `bft-api`'s `POST /v1/turnstile/verify` with `{ token, remoteip }`.
  - The Workers call it through their existing `API` service binding (`API_BASE` over HTTPS when unbound).
  - Vercel calls `https://api.brisbaneferry.com/v1/turnstile/verify`, which is `bft-api-prod`.
  - `bft-api` runs siteverify with its `TURNSTILE_SECRET` and returns only `success`, `hostname` and `action`. The relay then requires `success`, action `feedback`, and a hostname equal to the host the feedback was posted to.
  - Anything else is a **403**. A verify call that fails or times out, or a missing secret on `bft-api`, is a **503**. Nothing reaches Discord in either case.
  - The verify endpoint only reports on a token the caller already holds, and siteverify redeems the token as it answers, so the endpoint can't be used to mint or replay tokens.
  - It is rate limited before any siteverify call, in two steps.
    - **Burst:** `VERIFY_LIMITER`, 20 a minute per `CF-Connecting-IP` (never the body's `remoteip`), ids 8003 (staging) and 8004 (prod). Its counters are per Cloudflare location.
    - **Aggregate:** 300 a minute in all, counted in one `Budget` Durable Object instance (`turnstile-verify`, `src/ai/verify-window.ts`), so it holds across locations. The window is persisted in that instance's storage, so evicting the idle DO doesn't reset it. It doesn't touch the AI ledger instance.
    - The Workers forward the visitor's IP over the binding; Vercel's calls count against its egress IPs.
    - Over a limit, `bft-api` answers 429, and the relay answers 503 (fail closed). A limiter or DO error is also a 503.
    - Trade-off: a distributed flood can use up the aggregate budget and pause web feedback for up to a minute. That is preferred to unbounded siteverify calls.
- **The iOS path (token-less):** the Capacitor app can't run the widget on its `capacitor://` page.
  - Requests with `Origin: capacitor://localhost` (or `ionic://localhost`) skip Turnstile and keep the per-IP rate limit and validation.
  - Newer builds also send `X-BFT-Client: ios/1`; it's allowed in CORS. Installed builds don't send it, so it is **not required** (`IOS_REQUIRE_CLIENT_HEADER = false` in `api/_turnstile.js`). Requiring it would break feedback in every installed build until an app update, for no security gain.
  - **Trade-off:** a browser page can't send that Origin, so browsers can't use the iOS path. Non-browser clients (curl, scripts) can send any Origin and header, so for them feedback is protected only by the rate limit and validation, as it was before Turnstile.
  - **Brett's decision (19 Oct):** keep `IOS_REQUIRE_CLIENT_HEADER = false` until an iOS app update that sends `X-BFT-Client: ios/1` has shipped and been adopted. **Then** flip it to `true` in `api/_turnstile.js`, in a PR into develop with the usual review, released like any other change. That PR must also update the tests: today's tests expect header-less iOS feedback to succeed and don't exercise the required-header mode, so add coverage for it (header present → allowed; header missing → treated as web, so 403 without a token). Until then, the Origin alone qualifies.
- **CSP:** `https://challenges.cloudflare.com` in `script-src` and `frame-src` only, per [Cloudflare's Turnstile CSP reference](https://developers.cloudflare.com/turnstile/reference/content-security-policy/). That covers `vercel.json`, the `index.html` meta and the ferry Worker; transit already had it. No `connect-src` change: that is only for pre-clearance mode, which isn't used.
- **Privacy:** `public/privacy.html` (also served by the ferry and transit apps) now names Cloudflare Turnstile for web feedback.
- **Tests:** the test sitekey `1x00000000000000000000AA` appears only in tests (the Playwright configs, with the script stubbed by `apps/ferry/tests/turnstile-stub.ts`, and unit tests). Never put it in deployed config; the wrangler-config tests check that.
- **Check after deploy:** submit web feedback on staging (`bft-ferry`, `bft-transit`) and on www.brisbaneferry.com: one Discord post each. On www, the page source (or the Turnstile iframe URL) must carry the PROD sitekey. Repeat on ferry.lifemap.au if it was added to the PROD widget. A `curl` POST without a token from a browser Origin gets a 403.
- **Rollback:** revert the release. `/v1/turnstile/verify` on `bft-api` can stay: nothing else calls it.
