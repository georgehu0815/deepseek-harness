#!/usr/bin/env bash
#
# run-windows-brain.sh — rebuild, reload, and rerun the DeepSeek Harness Web UI
# with the native Claude Code "windows-brain" plugin mounted, so its slash
# commands (and its subagents, MCP servers, and skills) are usable from the
# Web UI or app.
#
# It performs, idempotently:
#   1. build   — compile the affected packages so their runtime lib/ exists
#                (the CC bundle + cc-commands + mcp-client resolve via lib/).
#   2. profile — scaffold/refresh a dedicated dsh profile whose bundle stack is
#                [dsh-base, dsh-web-app, dsh-claude-code-plugin].
#   3. rows    — regenerate the per-plugin mcp-client + tool-subagent rows into
#                the profile's cordis.patch.yml from the plugin's .mcp.json and
#                agents/ (re-run any time you edit the plugin).
#   4. run     — boot `dsh --profile <name>` (the Web app) from the generated,
#                self-contained profile configuration.
#
# Usage:
#   ./run-windows-brain.sh                 # full rebuild + reload + run
#   ./run-windows-brain.sh --no-build      # skip the build (fast reload+run)
#   ./run-windows-brain.sh --rows-only     # only regenerate rows, then run
#   ./run-windows-brain.sh --port 3090     # serve on a different port
#   PLUGIN_ROOT=/abs/other/plugin ./run-windows-brain.sh
#
set -euo pipefail

# --- Resolve locations -------------------------------------------------------

# Repo root = the directory holding this script (script lives at repo root).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  echo "error: pnpm or corepack is required" >&2
  exit 1
fi

PLUGIN_ROOT="${PLUGIN_ROOT:-/Users/ghu/work/windows-brain-agent-harness/brainagentharness/plugin}"
PROFILE_NAME="${PROFILE_NAME:-windows-brain}"
PORT="${PORT:-3080}"
PROVIDER="${PROVIDER:-spawn}"

BUNDLE_DIR="$REPO_ROOT/packages/bundle/claude-code-plugin"
INSTALL_GEN="$BUNDLE_DIR/scripts/install.mjs"

DO_BUILD=1
DO_ROWS=1
DO_RUN=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build)  DO_BUILD=0 ;;
    --rows-only) DO_BUILD=0; DO_RUN=1 ;;   # regenerate rows then run, no build
    --no-run)    DO_RUN=0 ;;
    --port)      PORT="$2"; shift ;;
    --plugin)    PLUGIN_ROOT="$2"; shift ;;
    --profile)   PROFILE_NAME="$2"; shift ;;
    -h|--help)
      sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

# DSH keeps all user data under $DSH_HOME (default ~/.dsh); the profile lives at
# $DSH_HOME/profiles/<name>. Resolve it the same way dsh does.
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"

echo "==> repo     : $REPO_ROOT"
echo "==> plugin   : $PLUGIN_ROOT"
echo "==> profile  : $PROFILE_DIR"
echo "==> web port : $PORT"

if [ ! -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ] && [ ! -d "$PLUGIN_ROOT/commands" ]; then
  echo "error: no Claude Code plugin at $PLUGIN_ROOT" >&2
  exit 1
fi

# --- 1. Build ----------------------------------------------------------------
# The CC bundle and cc-commands resolve through their built lib/index.js, and
# apps/cli lists dsh-claude-code-plugin as a dependency so the profile module
# fallback links it and its closure. `pnpm run build` emits lib/ for every
# host-face package (tsc types + tsdown runtime) and the web client bundle.

if [ "$DO_BUILD" -eq 1 ]; then
  echo "==> building (lib/ runtime + web client) ..."
  # Keep profile launches from changing the repository dependency graph.
  CI=true "${PNPM[@]}" install --frozen-lockfile
  "${PNPM[@]}" run build
else
  echo "==> skipping build (--no-build)"
fi

# --- 2. Profile --------------------------------------------------------------
# Scaffold the profile with the Web UI + CC bundle stack if absent. dsh boots
# the Web app from the `web-app` bundle; `claude-code-plugin` adds the plugin.

mkdir -p "$PROFILE_DIR"
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "==> scaffolding profile $PROFILE_NAME"
  cat > "$PROFILE_DIR/package.json" <<JSON
{
  "name": "dsh-profile-$PROFILE_NAME",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-claude-code-plugin"
      ]
    }
  }
}
JSON
  # Profiles resolve in-box bundles through $DSH_HOME/profiles/node_modules,
  # which dsh heals on boot; a pnpm workspace file keeps pnpm out of it.
  printf 'packages: []\n' > "$PROFILE_DIR/pnpm-workspace.yaml"
else
  echo "==> reusing existing profile $PROFILE_NAME"
fi

# --- 3. Rows -----------------------------------------------------------------
# Regenerate the per-plugin mcp-client + tool-subagent rows into the profile's
# cordis.patch.yml (the profile's own patch layer, applied after the bundles).
# Re-run this any time the plugin's .mcp.json or agents/ change.

if [ "$DO_ROWS" -eq 1 ]; then
  echo "==> generating MCP + subagent rows into profile patch"
  node "$INSTALL_GEN" "$PLUGIN_ROOT" "$PROFILE_DIR" --provider "$PROVIDER"
fi

# --- 4. Run ------------------------------------------------------------------
# Boot the Web app profile. The generated profile patch contains the absolute
# plugin paths needed by skills, commands, and hooks.

if [ "$DO_RUN" -eq 1 ]; then
  echo "==> launching Web UI at http://127.0.0.1:$PORT (profile: $PROFILE_NAME)"
  echo "    slash commands appear as /$PROFILE_NAME-<command>"
  exec "${PNPM[@]}" dsh --profile "$PROFILE_NAME" --port "$PORT"
fi
