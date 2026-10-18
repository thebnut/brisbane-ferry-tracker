#!/usr/bin/env bash
# Run a command with the local R2 uploader available (pipeline/r2-uploader: `wrangler dev` on 127.0.0.1 with a
# *remote* R2 binding to bft-transit-data, authenticated by your wrangler login). The command gets UPLOADER_URL and
# UPLOADER_TOKEN, so `cli.ts build --previous uploader` and `cli.ts publish --target uploader` work. The uploader is
# stopped when the command exits. Example:
#   scripts/with-r2-uploader.sh pnpm build:data --gtfs /tmp/bft-gtfs/x --previous uploader
#   scripts/with-r2-uploader.sh pnpm publish:data --from out --target uploader
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${UPLOADER_PORT:-8799}"
TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
LOG="$(mktemp -t bft-uploader)"
pnpm exec wrangler dev --config r2-uploader/wrangler.jsonc --ip 127.0.0.1 --port "$PORT" \
  --var "UPLOADER_TOKEN:$TOKEN" --show-interactive-dev-session=false >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "x-uploader-token: $TOKEN" "http://127.0.0.1:$PORT/manifest.json" || true)"
  if [ "$code" = 200 ] || [ "$code" = 404 ]; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then echo "uploader failed to start:" >&2; cat "$LOG" >&2; exit 1; fi
  sleep 1
done
echo "R2 uploader ready on 127.0.0.1:$PORT (log $LOG)" >&2
UPLOADER_URL="http://127.0.0.1:$PORT" UPLOADER_TOKEN="$TOKEN" "$@"
