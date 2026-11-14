#!/bin/sh
set -eu

: "${RAILWAY_TOKEN:?RAILWAY_TOKEN is required}"
: "${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID is required}"
: "${RAILWAY_ENVIRONMENT_ID:?RAILWAY_ENVIRONMENT_ID is required}"
: "${RAILWAY_DATABASE_SERVICE_ID:?RAILWAY_DATABASE_SERVICE_ID is required}"
: "${CLOUDFLARE_TUNNEL_TOKEN:?CLOUDFLARE_TUNNEL_TOKEN is required}"

LOCAL_FORWARD_PORT="${LOCAL_FORWARD_PORT:-15432}"
case "$LOCAL_FORWARD_PORT" in
  ''|*[!0-9]*) echo "LOCAL_FORWARD_PORT must be numeric" >&2; exit 2 ;;
esac

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dawn-railway-tunnel.XXXXXX")"
RAILWAY_PID=""
CLOUDFLARED_PID=""

cleanup() {
  if [ -n "$CLOUDFLARED_PID" ]; then kill "$CLOUDFLARED_PID" 2>/dev/null || true; fi
  if [ -n "$RAILWAY_PID" ]; then kill "$RAILWAY_PID" 2>/dev/null || true; fi
  if [ -n "$CLOUDFLARED_PID" ]; then wait "$CLOUDFLARED_PID" 2>/dev/null || true; fi
  if [ -n "$RAILWAY_PID" ]; then wait "$RAILWAY_PID" 2>/dev/null || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
TOKEN_FILE="$WORK_DIR/cloudflare-tunnel-token"
printf '%s' "$CLOUDFLARE_TUNNEL_TOKEN" > "$TOKEN_FILE"
unset CLOUDFLARE_TUNNEL_TOKEN

cd "$WORK_DIR"
if ! railway link --project "$RAILWAY_PROJECT_ID" --environment "$RAILWAY_ENVIRONMENT_ID" --service "$RAILWAY_DATABASE_SERVICE_ID" --json >/dev/null 2>&1; then
  echo "Railway project linking failed; check the project token and target IDs." >&2
  exit 1
fi

# Railway prints database connection details for --tunnel-only. Suppress all
# output so credentials never enter container logs.
railway connect "$RAILWAY_DATABASE_SERVICE_ID" --environment "$RAILWAY_ENVIRONMENT_ID" --tunnel-only --port "$LOCAL_FORWARD_PORT" >/dev/null 2>&1 &
RAILWAY_PID=$!

attempt=0
until nc -z 127.0.0.1 "$LOCAL_FORWARD_PORT" >/dev/null 2>&1; do
  if ! kill -0 "$RAILWAY_PID" 2>/dev/null; then
    wait "$RAILWAY_PID" 2>/dev/null || true
    echo "Railway SSH database tunnel exited before its local port became ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Timed out waiting for the Railway SSH database tunnel." >&2
    exit 1
  fi
  sleep 1
done

cloudflared tunnel --no-autoupdate run --token-file "$TOKEN_FILE" &
CLOUDFLARED_PID=$!

# Keep the connector alive only while both underlying tunnel processes live.
# The host/container supervisor should restart this process after a failure.
while kill -0 "$RAILWAY_PID" 2>/dev/null && kill -0 "$CLOUDFLARED_PID" 2>/dev/null; do
  sleep 5
done

echo "A tunnel process exited; stopping the connector so the host supervisor can restart it." >&2
exit 1
