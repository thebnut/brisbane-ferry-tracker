#!/usr/bin/env bash
# Read-only health check for the train, bus and transit Workers (docs/architecture/cutover-runbook.md, "Train, bus
# and transit production"). Only GET/HEAD requests; nothing is changed. Runs against any host:
#
#   scripts/prod-check.sh train https://bft-train.brisbanetransit.workers.dev            # staging
#   scripts/prod-check.sh bus https://bft-bus-prod.brisbanetransit.workers.dev \
#     --site https://brisbanebus.com --prod                                               # production-preview
#   scripts/prod-check.sh transit https://brisbanetransit.com --prod --www                # real domain
#
# Options:
#   --site URL        the Worker's SITE_URL (canonical origin used in sitemaps); default: the base URL
#   --indexable 0|1   the expected INDEXABLE (default 0: X-Robots-Tag noindex, robots.txt Disallow: /)
#   --prod            production expectations: fixture routes 404 and ?fixtures=1 is ignored
#   --www             also check that www.<host of base> 301s to the base URL (real domains only)
# Exit status: 0 when every check passes, 1 otherwise.
set -uo pipefail

app="${1:-}"
base="${2:-}"
[[ -z "$app" || -z "$base" ]] && { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
shift 2
base="${base%/}"
site="$base"
indexable=0
prod=0
www=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) site="${2%/}"; shift 2 ;;
    --indexable) indexable="$2"; shift 2 ;;
    --prod) prod=1; shift ;;
    --www) www=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$app" in
  train)
    pages=(/ /stations /station/central /alerts)
    sitemap=/sitemap.xml
    live=(/v1/train/stops/central/departures /v1/alerts?mode=train)
    ;;
  bus)
    pages=(/ /stop/1832 /alerts /about)
    sitemap=/sitemaps/pages.xml
    live=(/v1/bus/stops/1832/departures /v1/alerts?mode=bus)
    ;;
  transit)
    pages=(/ /train/station/central /bus/stop/1832 /ferry/terminal/bulimba /alerts)
    sitemap=
    live=(/v1/train/stops/central/departures /v1/ferry/stops/317584/departures?to=317590 /v1/alerts)
    ;;
  *) echo "app must be train, bus or transit" >&2; exit 2 ;;
esac

fails=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
check() { if [[ "$1" == 1 ]]; then pass "$2"; else fail "$2${3:+ ($3)}"; fi; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# fetch URL NAME: body to $tmp/NAME.body, headers (lower-cased names) to $tmp/NAME.h, status echoed. No redirects.
fetch() {
  curl -sS --max-time 20 -o "$tmp/$2.body" -D "$tmp/$2.raw" -w '%{http_code}' -H 'user-agent: bft-prod-check/1' "$1" 2>/dev/null || echo 000
  tr -d '\r' <"$tmp/$2.raw" 2>/dev/null | awk -F': ' 'NF>1 {printf "%s: %s\n", tolower($1), substr($0, length($1)+3)}' >"$tmp/$2.h"
}
header() { grep -i "^$2: " "$tmp/$1.h" | head -1 | cut -d' ' -f2-; }
has() { [[ "$1" == *"$2"* ]] && echo 1 || echo 0; }

echo "prod-check $app $base (site $site, indexable $indexable, prod $prod) $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Pages, security headers and nonce CSP"
n=0
for p in "${pages[@]}"; do
  n=$((n + 1))
  code="$(fetch "$base$p" "page$n")"
  ct="$(header "page$n" content-type)"
  csp="$(header "page$n" content-security-policy)"
  scriptsrc="$(tr ';' '\n' <<<"$csp" | grep -E '^ *script-src' || true)"
  check "$([[ "$code" == 200 && "$ct" == text/html* ]] && echo 1 || echo 0)" "GET $p -> 200 HTML" "got $code $ct"
  check "$([[ -n "$scriptsrc" && "$scriptsrc" == *"'nonce-"* && "$scriptsrc" != *unsafe-inline* ]] && echo 1 || echo 0)" \
    "$p CSP script-src has a nonce and no 'unsafe-inline'"
  check "$([[ "$csp" == *"frame-ancestors 'none'"* && "$csp" == *"object-src 'none'"* ]] && echo 1 || echo 0)" \
    "$p CSP frame-ancestors 'none' and object-src 'none'"
  check "$(has "$(header "page$n" strict-transport-security)" max-age=)" "$p HSTS"
  check "$(has "$(header "page$n" x-content-type-options)" nosniff)" "$p X-Content-Type-Options: nosniff"
  check "$([[ -n "$(header "page$n" referrer-policy)" && -n "$(header "page$n" permissions-policy)" ]] && echo 1 || echo 0)" \
    "$p Referrer-Policy and Permissions-Policy"
  check "$(has "$(header "page$n" cache-control)" no-store)" "$p HTML Cache-Control no-store" "$(header "page$n" cache-control)"
  robots="$(header "page$n" x-robots-tag)"
  if [[ "$indexable" == 1 ]]; then
    check "$([[ "$robots" != *noindex* ]] && echo 1 || echo 0)" "$p no X-Robots-Tag noindex (INDEXABLE=1)" "$robots"
  else
    check "$(has "$robots" noindex)" "$p X-Robots-Tag: noindex (INDEXABLE=0)" "${robots:-absent}"
  fi
done

echo "Static assets"
asset="$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' "$tmp/page1.body" | head -1)"
if [[ -z "$asset" ]]; then
  fail "home page references an /assets/*.js file"
else
  code="$(fetch "$base$asset" asset)"
  check "$([[ "$code" == 200 ]] && echo 1 || echo 0)" "GET $asset -> 200" "got $code"
  check "$(has "$(header asset cache-control)" immutable)" "$asset Cache-Control immutable" "$(header asset cache-control)"
  check "$(has "$(header asset x-content-type-options)" nosniff)" "$asset nosniff (public/_headers)"
  check "$(has "$(header asset strict-transport-security)" max-age=)" "$asset HSTS (public/_headers)"
fi

echo "robots.txt and sitemap"
code="$(fetch "$base/robots.txt" robots)"
body="$(cat "$tmp/robots.body")"
if [[ "$indexable" == 1 && "$app" != transit ]]; then
  check "$([[ "$code" == 200 && "$body" == *"Allow: /"* && "$body" == *"Sitemap: $site/sitemap.xml"* ]] && echo 1 || echo 0)" \
    "robots.txt allows crawling and names $site/sitemap.xml"
else
  check "$([[ "$code" == 200 && "$body" == *"Disallow: /"* && "$body" != *"Allow: /"* ]] && echo 1 || echo 0)" \
    "robots.txt Disallow: / ($([[ "$app" == transit ]] && echo 'transit: always' || echo 'INDEXABLE=0'))"
fi
if [[ -n "$sitemap" ]]; then
  code="$(fetch "$base$sitemap" sitemap)"
  locs="$(grep -c '<loc>' "$tmp/sitemap.body" || true)"
  foreign="$(grep -o '<loc>[^<]*' "$tmp/sitemap.body" | grep -vc "<loc>$site/" || true)"
  check "$([[ "$code" == 200 && "$locs" -gt 0 && "$foreign" == 0 ]] && echo 1 || echo 0)" \
    "GET $sitemap -> 200, $locs URLs, all under $site" "got $code, $foreign outside $site"
fi

echo "Live data through the /v1 proxy"
n=0
for p in "${live[@]}"; do
  n=$((n + 1))
  code="$(fetch "$base$p" "live$n")"
  state="$(grep -oE '"rtState":"[a-z_]+"' "$tmp/live$n.body" | head -1 | cut -d'"' -f4)"
  check "$([[ "$code" == 200 && ("$state" == live || "$state" == stale) ]] && echo 1 || echo 0)" \
    "GET $p -> 200, rtState ${state:-missing}" "got $code"
done

echo "Fixtures"
code="$(fetch "$base/__fixtures/v1/alerts" fixtures)"
if [[ "$prod" == 1 ]]; then
  check "$([[ "$code" == 404 ]] && echo 1 || echo 0)" "/__fixtures/v1/alerts -> 404 (no fixtures in production)" "got $code"
  code="$(fetch "$base${pages[1]}?fixtures=1" fixturepage)"
  check "$([[ "$code" == 200 ]] && ! grep -qi 'demo data\|fixture' "$tmp/fixturepage.body" && echo 1 || echo 0)" \
    "${pages[1]}?fixtures=1 serves live data (no demo or fixture notice)"
else
  printf '  INFO  /__fixtures/v1/alerts -> %s (staging allows ?fixtures=1)\n' "$code"
fi

if [[ "$www" == 1 ]]; then
  echo "www -> apex"
  host="${base#https://}"
  host="${host%%/*}"
  code="$(fetch "https://www.$host/prod-check/path?q=1&r=2" www)"
  loc="$(header www location)"
  check "$([[ "$code" == 301 && "$loc" == "$base/prod-check/path?q=1&r=2" ]] && echo 1 || echo 0)" \
    "https://www.$host/prod-check/path?q=1&r=2 -> 301 $base/prod-check/path?q=1&r=2" "got $code ${loc:-no location}"
fi

echo
if [[ "$fails" == 0 ]]; then echo "ALL PASS ($app $base)"; else echo "$fails FAILED ($app $base)"; fi
[[ "$fails" == 0 ]]
