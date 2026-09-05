#!/usr/bin/env bash
set -euo pipefail

port="${PORT:-${DSH_WEB_PORT:-3080}}"
status=0
roots=()

[[ "$port" =~ ^[0-9]+$ ]] || {
  echo "error: PORT must be numeric, got $port" >&2
  exit 1
}

descendant_pids() {
  local parent="$1"
  local child
  while IFS= read -r child; do
    [[ "$child" =~ ^[0-9]+$ ]] || continue
    descendant_pids "$child"
    printf '%s\n' "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

process_is_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')"
  [[ -n "$state" && "$state" != Z* ]]
}

terminate_tree() {
  local root="$1"
  local pid
  local attempt
  local alive
  local targets=()

  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] && targets+=("$pid")
  done < <(descendant_pids "$root")
  targets+=("$root")

  kill -TERM "${targets[@]}" 2>/dev/null || true
  for ((attempt = 0; attempt < 50; attempt++)); do
    alive=0
    for pid in "${targets[@]}"; do
      process_is_running "$pid" && alive=1
    done
    ((alive == 0)) && return 0
    sleep 0.1
  done

  echo "DSH Web process tree did not stop after 5 seconds; forcing shutdown." >&2
  for pid in "${targets[@]}"; do
    process_is_running "$pid" && kill -KILL "$pid" 2>/dev/null || true
  done
}

matches="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN -a -u "$(id -u)")" || status=$?
if ((status > 1)); then
  exit "$status"
fi

while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  command="$(ps -o command= -p "$pid")"
  case "$command" in
    *"apps/cli/src/bin.ts web"*|*"apps/cli/src/bin.ts --profile "*) roots+=("$pid") ;;
    *)
      echo "Port $port is used by a non-DSH process (pid $pid): $command" >&2
      echo "Refusing to stop it." >&2
      exit 1
      ;;
  esac
done <<< "$matches"

if ((${#roots[@]} == 0)); then
  echo "No DSH Web server is listening on port $port."
  exit 0
fi

for pid in "${roots[@]}"; do
  echo "Stopping DSH Web server on port $port (pid $pid)…"
  terminate_tree "$pid"
done
