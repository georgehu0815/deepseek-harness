#!/usr/bin/env bash
# shellcheck disable=SC2329  # Trap callbacks and their helpers are indirect entry points.
# Start DeepSeek Harness Web with the geo-segmentation provider and local SAM3 backend.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

SAM_BACKEND_URL="${SAM_BACKEND_URL:-http://localhost:8000}"
SAM_REPO="${SAM_REPO:-$(cd "$REPO_ROOT/.." && pwd)/segment-geospatial}"
START_BACKEND="${START_BACKEND:-1}"
DSH_WEB_PORT="${DSH_WEB_PORT:-3080}"
RESTART_EXISTING="${RESTART_EXISTING:-1}"
OVERLAY="$REPO_ROOT/examples/geo-segmentation.overlay.cordis.yml"
BACKEND_DIR="$SAM_REPO/mlx_sam3/app/backend"

[[ "$DSH_WEB_PORT" =~ ^[0-9]+$ ]] || {
  echo "error: DSH_WEB_PORT must be numeric, got $DSH_WEB_PORT" >&2
  exit 1
}
export SAM_BACKEND_URL

BACKEND_PID=""
BACKEND_PGID=""
WEB_PID=""
WEB_PGID=""
PROBE_PNG=""
CLEANED_UP=0

# Each managed child gets a process group so teardown reaches grandchildren.
set -m

group_is_running() {
  kill -0 -- "-$1" 2>/dev/null
}

terminate_group() {
  local label="$1" pgid="$2" attempt own_pgid
  [[ "$pgid" =~ ^[0-9]+$ ]] || return 0
  own_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
  if [[ "$pgid" == "$own_pgid" ]]; then
    echo "error: refusing to stop $label process group $pgid because it contains this launcher" >&2
    return 1
  fi
  group_is_running "$pgid" || return 0
  echo "Stopping $label (process group $pgid)…"
  kill -TERM -- "-$pgid" 2>/dev/null || true
  for ((attempt = 0; attempt < 50; attempt++)); do
    group_is_running "$pgid" || return 0
    sleep 0.1
  done
  echo "$label did not stop after 5 seconds; forcing shutdown." >&2
  kill -KILL -- "-$pgid" 2>/dev/null || true
}

process_is_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')"
  [[ -n "$state" && "$state" != Z* ]]
}

terminate_process() {
  local label="$1" pid="$2" attempt
  process_is_running "$pid" || return 0
  echo "Stopping $label (pid $pid)…"
  kill -TERM "$pid" 2>/dev/null || true
  for ((attempt = 0; attempt < 50; attempt++)); do
    process_is_running "$pid" || return 0
    sleep 0.1
  done
  echo "$label did not stop after 5 seconds; forcing shutdown." >&2
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  ((CLEANED_UP == 0)) || return 0
  CLEANED_UP=1
  [[ -z "$WEB_PGID" ]] || terminate_group "dsh web" "$WEB_PGID"
  [[ -z "$BACKEND_PGID" ]] || terminate_group "SAM3 backend" "$BACKEND_PGID"
  [[ -z "$PROBE_PNG" ]] || rm -f "$PROBE_PNG"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$RESTART_EXISTING" == "1" ]]; then
  PORT="$DSH_WEB_PORT" "$REPO_ROOT/stop-dsh-web.sh"
  if [[ "$START_BACKEND" == "1" ]]; then
    BACKEND_PORT="${SAM_BACKEND_URL##*:}"
    BACKEND_PORT="${BACKEND_PORT%%/*}"
    if [[ "$BACKEND_PORT" =~ ^[0-9]+$ ]]; then
      while IFS= read -r old_backend; do
        [[ -n "$old_backend" ]] || continue
        old_command="$(ps -o command= -p "$old_backend")"
        case "$old_command" in
          *"$BACKEND_DIR/main.py"*) terminate_process "previous SAM3 backend" "$old_backend" ;;
          *)
            echo "error: backend port $BACKEND_PORT is used by a non-SAM3 process (pid $old_backend): $old_command" >&2
            exit 1
            ;;
        esac
      done < <(lsof -nP -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN -a -u "$(id -u)" 2>/dev/null || true)
    fi
  fi
fi

if [[ "$START_BACKEND" == "1" ]]; then
  [[ -f "$BACKEND_DIR/main.py" ]] || {
    echo "error: SAM3 backend not found at $BACKEND_DIR" >&2
    echo "       set SAM_REPO to your segment-geospatial checkout." >&2
    exit 1
  }
  echo "Starting SAM3 backend from $BACKEND_DIR …"
  (cd "$SAM_REPO/mlx_sam3" && exec uv run --no-sync python "$BACKEND_DIR/main.py") &
  BACKEND_PID=$!
  BACKEND_PGID="$(ps -o pgid= -p "$BACKEND_PID" | tr -d ' ')"
fi

echo -n "Waiting for backend route at $SAM_BACKEND_URL "
route_ready=0
for _ in $(seq 1 120); do
  if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo
    echo "error: SAM3 backend exited before becoming ready." >&2
    exit 1
  fi
  if curl -fsS "$SAM_BACKEND_URL/openapi.json" 2>/dev/null | grep -q '/segment/geo'; then
    echo "— route registered."
    route_ready=1
    break
  fi
  echo -n "."
  sleep 1
done
[[ "$route_ready" == "1" ]] || {
  echo
  echo "error: /segment/geo not registered at $SAM_BACKEND_URL after 120s." >&2
  exit 1
}

echo -n "Probing $SAM_BACKEND_URL/segment/geo for a live response "
PROBE_PNG="$(mktemp -t sam-probe.XXXXXX.png)"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
  | base64 --decode > "$PROBE_PNG" 2>/dev/null || \
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
  | base64 -D > "$PROBE_PNG"

api_ready=0
for _ in $(seq 1 60); do
  if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo
    echo "error: SAM3 backend exited during the readiness probe." >&2
    exit 1
  fi
  body="$(curl -sS -m 30 -X POST "$SAM_BACKEND_URL/segment/geo" \
    -F "file=@$PROBE_PNG;type=image/png" -F "prompt=building" \
    -F "bbox=0,0,0.001,0.001" -F "geometry=mask" \
    -F "confidence_threshold=0.25" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -qE '^[[:space:]]*\{'; then
    echo "— API is live."
    api_ready=1
    break
  fi
  echo -n "."
  sleep 1
done
[[ "$api_ready" == "1" ]] || {
  echo
  echo "error: $SAM_BACKEND_URL/segment/geo did not return JSON after warm-up." >&2
  exit 1
}

echo "Booting dsh web (port $DSH_WEB_PORT) with segmentation enabled…"
pnpm dsh web --patch "$OVERLAY" "$@" --port "$DSH_WEB_PORT" &
WEB_PID=$!
WEB_PGID="$(ps -o pgid= -p "$WEB_PID" | tr -d ' ')"

set +e
wait "$WEB_PID"
web_status=$?
set -e
exit "$web_status"
