#!/usr/bin/env bash
# Bootstrap the native DSH Robot Lab; never starts upstream web apps or hardware.
# Personal profile patches are preserved. Downloads require explicit setup/clone
# options or a missing CPU environment; existing source checkouts are never updated.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./run-robot-lab.sh [options]

Build and boot the native UI, CPU training, policy replay and evaluation services.
Requires Node 22.19+ (22.x or >=24), pnpm, and a MicroDuck Lab source checkout.
Python setup uses uv and the upstream frozen Python 3.12 lock when needed.

  --source DIR      Lab checkout (default: sibling ../microduck-lab or
                    DSH_MICRODUCK_SOURCE_ROOT). Not its microduck_local subdir.
  --clone-source    Clone missing Lab, microduck and microduck_rl checkouts.
                    Existing directories are never pulled, reset or overwritten.
  --python FILE     Reuse an installed Python environment without changing it
                    (also DSH_MICRODUCK_PYTHON).
  --setup-python    Use/sync the managed environment instead of Lab's .venv.
  --setup-mlx       Install optional MLX 0.31.1 in a separate managed Python 3.12
                    environment (Apple Silicon macOS only; may download wheels).
  --mlx-python FILE Reuse an absolute Python 3.12 path with MLX 0.31.1 + Metal
                    without installation (also DSH_MICRODUCK_MLX_PYTHON).
                    Mutually exclusive with --setup-mlx.
  --profile NAME    Dedicated profile (default: robot-lab).
  --port NUMBER     Loopback Web port (default: 3082; never kills an occupant).
  --no-build        Reuse installed Node dependencies and built UI/backend.
  --verify          Run a real 1024-step train/export/reload/evaluate smoke through
                    the DSH provider and sandbox; save a fresh evidence report.
  --setup-only      Set up and check everything, then exit without a Web server.
  -h, --help        Show help without making changes.

First-time: ./run-robot-lab.sh --clone-source --verify
Fast boot:  ./run-robot-lab.sh --no-build
Check only: ./run-robot-lab.sh --no-build --verify --setup-only

State: ${DSH_HOME:-$HOME/.dsh}/robot-lab; profile: DSH_HOME/profiles/NAME.
The launcher reuses Lab's existing .venv when present unless --setup-python is set.
Frozen uv setup can download Python and large wheels (CUDA dependencies on Linux
x86_64 even though training runs on CPU). Intel macOS is unsupported by this lock.
Chat needs a configured model provider; direct Robot controls need no model key.
CPU is the default; MLX is never installed or selected automatically. --setup-mlx
uses DSH_HOME/robot-lab/mlx-venv, not the CPU environment or Lab's .venv.
MLX uses a separate PPO recipe with CPU MuJoCo physics: not full-GPU simulation
and no speedup guarantee. A selected MLX interpreter must pass Metal execution;
failure stops launch without CPU fallback. Explicit profile overrides take precedence.
--verify proves the CPU pipeline, not GPU training, choreography or hardware safety.
Physical deployment remains unavailable.
HELP
}
fail() { printf 'Robot Lab: %s\n' "$*" >&2; exit 1; }
value() { [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || fail "$1 requires a value"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB="${DSH_MICRODUCK_SOURCE_ROOT:-$REPO_ROOT/../microduck-lab}"
PY="${DSH_MICRODUCK_PYTHON:-}"
MLX_PY="${DSH_MICRODUCK_MLX_PYTHON:-}"
SETUP_MLX=0
PROFILE=robot-lab
PORT=3082
CLONE=0
SETUP_PYTHON=0
BUILD=1
VERIFY=0
RUN=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) value "$@"; LAB="$2"; shift ;;
    --python) value "$@"; PY="$2"; shift ;;
    --mlx-python) value "$@"; MLX_PY="$2"; shift ;;
    --setup-mlx) SETUP_MLX=1 ;;
    --profile) value "$@"; PROFILE="$2"; shift ;;
    --port) value "$@"; PORT="$2"; shift ;;
    --clone-source) CLONE=1 ;;
    --setup-python) SETUP_PYTHON=1 ;;
    --no-build) BUILD=0 ;;
    --verify) VERIFY=1 ;;
    --setup-only) RUN=0 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option: $1 (use --help)" ;;
  esac
  shift
done
[[ "$PROFILE" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || fail 'invalid profile name'
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || fail 'port must be an integer from 1 to 65535'
PORT=$((10#$PORT))
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail 'port must be from 1 to 65535'
[ -z "$PY" ] || [ "$SETUP_PYTHON" -eq 0 ] || fail '--python/DSH_MICRODUCK_PYTHON conflicts with --setup-python'
[ -z "$MLX_PY" ] || [ "$SETUP_MLX" -eq 0 ] || fail '--mlx-python/DSH_MICRODUCK_MLX_PYTHON conflicts with --setup-mlx'
[ -z "$MLX_PY" ] || [[ "$MLX_PY" == /* ]] || fail '--mlx-python/DSH_MICRODUCK_MLX_PYTHON requires an absolute path'
if [ "$SETUP_MLX" -eq 1 ] || [ -n "$MLX_PY" ]; then
  [ "$(uname -s)/$(uname -m)" = Darwin/arm64 ] || fail 'MLX requires Apple Silicon macOS (Darwin arm64); CPU remains available without MLX options'
  [ -z "$MLX_PY" ] || [ -x "$MLX_PY" ] || fail "MLX Python is not executable: $MLX_PY"
fi
command -v node >/dev/null 2>&1 || fail 'install Node 22.19+ (22.x or >=24) first'
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (!(a===22&&b>=19 || a>=24)) process.exit(1)' || fail 'unsupported Node version; use 22.19+ (22.x) or >=24'
command -v pnpm >/dev/null 2>&1 || fail 'install pnpm (or enable its Corepack shim) first'
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64|Linux/x86_64|Linux/aarch64|Linux/arm64) ;;
  *) fail 'this bootstrap supports Apple Silicon macOS and Linux x86_64/aarch64; the frozen lock does not support Intel macOS' ;;
esac

# Resolve relative arguments before changing cwd for the workspace build.
export DSH_HOME="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "${DSH_HOME:-$HOME/.dsh}")"
LAB="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$LAB")"
if [ -n "$PY" ]; then
  [[ "$PY" == */* ]] || PY="$(command -v "$PY")" || fail 'Python executable not found'
  PY="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$PY")"
fi
STATE="$DSH_HOME/robot-lab"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"

# Check the listener before downloads/builds. DSH still owns the final bind race.
if [ "$RUN" -eq 1 ]; then
  node --input-type=module - "$PORT" <<'JS'
import net from 'node:net'
const server = net.createServer()
server.once('error', error => { console.error(`Robot Lab: port ${process.argv[2]} unavailable (${error.code}); choose --port. No process was stopped.`); process.exitCode = 1 })
server.listen({ host: '127.0.0.1', port: Number(process.argv[2]), exclusive: true }, () => server.close())
JS
fi

clone_missing() {
  if [ ! -e "$2" ]; then
    [ "$CLONE" -eq 1 ] || fail "missing checkout $2; provide --source or allow --clone-source"
    command -v git >/dev/null 2>&1 || fail 'install Git to clone source checkouts'
    mkdir -p "$(dirname "$2")"
    git clone --recursive "$1" "$2"
  fi
}
clone_missing https://github.com/georgehu0815/microduck-lab.git "$LAB"
[ -f "$LAB/microduck_local/pyproject.toml" ] && [ -f "$LAB/microduck_local/uv.lock" ] || fail "not a supported Lab checkout: $LAB"
clone_missing https://github.com/pollen-robotics/microduck.git "$LAB/microduck"
clone_missing https://github.com/pollen-robotics/microduck_rl.git "$LAB/microduck_rl"
for file in microduck_local/src/microduck_local/contract.py microduck_rl/src/mjlab_microduck/robot/microduck/scene_walk.xml microduck/policies/alpha_stand.onnx microduck/policies/alpha_walking.onnx; do
  [ -f "$LAB/$file" ] || fail "missing source asset $LAB/$file; existing checkouts are not overwritten"
done
mkdir -p "$STATE"
if [ -z "$PY" ]; then
  if [ "$SETUP_PYTHON" -eq 0 ] && [ -x "$LAB/microduck_local/.venv/bin/python" ]; then
    PY="$LAB/microduck_local/.venv/bin/python"
    echo '==> reusing installed Lab Python; no dependency changes'
  else
    command -v uv >/dev/null 2>&1 || fail 'install uv to provision Python 3.12, or pass --python /path/to/python'
    echo '==> synchronizing isolated Python 3.12 environment with the upstream frozen lock'
    UV_PROJECT_ENVIRONMENT="$STATE/venv" uv sync --frozen --python 3.12 --project "$LAB/microduck_local"
    PY="$STATE/venv/bin/python"
  fi
fi
[ -x "$PY" ] || fail "Python is not executable: $PY"
"$PY" -B -c 'import sys; assert sys.version_info[:2] == (3, 12), "MicroDuck Lab requires Python 3.12"'
if [ "$SETUP_MLX" -eq 1 ]; then
  command -v uv >/dev/null 2>&1 || fail 'install uv to provision MLX, or pass --mlx-python /absolute/path/to/python'
  [ ! -L "$STATE/mlx-venv" ] && [ ! -L "$STATE/mlx-venv/bin" ] || fail 'refusing to install MLX through a symlinked managed environment'
  echo '==> synchronizing separate MLX Python 3.12 environment with the upstream frozen lock'
  UV_PROJECT_ENVIRONMENT="$STATE/mlx-venv" uv sync --frozen --project "$LAB/microduck_local" --python 3.12 --no-editable
  MLX_PY="$STATE/mlx-venv/bin/python"
  [ -x "$MLX_PY" ] || fail "MLX Python is not executable: $MLX_PY"
  "$MLX_PY" -I -B -c 'import os, sys
if sys.version_info[:2] != (3, 12): raise RuntimeError("MLX requires Python 3.12")
if sys.prefix == sys.base_prefix or os.path.realpath(sys.prefix) != os.path.realpath(sys.argv[1]):
    raise RuntimeError("MLX installation requires the isolated managed virtual environment")' "$STATE/mlx-venv"
  uv pip install --python "$MLX_PY" 'mlx==0.31.1'
fi
if [ -n "$MLX_PY" ]; then
  echo '==> checking selected MLX interpreter and real Metal execution (not training verification)'
  "$MLX_PY" -I -B -c 'import sys, platform
if sys.version_info[:2] != (3, 12): raise RuntimeError("MLX requires Python 3.12")
if sys.platform != "darwin" or platform.machine() != "arm64": raise RuntimeError("MLX requires native Apple Silicon Python")
from importlib.metadata import version
if version("mlx") != "0.31.1": raise RuntimeError("MLX requires mlx==0.31.1")
import mlx.core as mx
if not mx.metal.is_available(): raise RuntimeError("MLX Metal is unavailable; no CPU fallback")
mx.set_default_device(mx.gpu)
result = mx.add(mx.array([1.0]), mx.array([2.0]), stream=mx.gpu)
mx.eval(result)
if result.item() != 3.0: raise RuntimeError("MLX Metal execution returned an unexpected result")
print("MLX 0.31.1 Metal execution passed; MuJoCo physics remains on CPU")'
fi
export DSH_MICRODUCK_SOURCE_ROOT="$LAB" DSH_MICRODUCK_PYTHON="$PY"
if [ -n "$MLX_PY" ]; then export DSH_MICRODUCK_MLX_PYTHON="$MLX_PY"; else unset DSH_MICRODUCK_MLX_PYTHON; fi
export PYTHONDONTWRITEBYTECODE=1
printf '==> Lab: %s\n==> Python: %s\n' "$LAB" "$PY"
for dir in "$LAB" "$LAB/microduck" "$LAB/microduck_rl"; do
  if [ -e "$dir/.git" ]; then printf '    source revision %s: ' "$dir"; git -C "$dir" rev-parse HEAD; fi
done

cd "$REPO_ROOT"
if [ "$BUILD" -eq 1 ]; then
  CI=true pnpm install --frozen-lockfile
  pnpm run build
fi
for file in apps/cli/lib/bin.js packages/robot/robot-lab/lib/index.js packages/robot/robot-lab-microduck/lib/index.js packages/client/ui-robot-lab/lib/client.js; do
  [ -f "$file" ] || fail "missing build artifact $file; rerun without --no-build"
done

# Never regenerate an existing profile or its patches. Reject unrelated profiles.
node --input-type=module - "$PROFILE_DIR" "$PROFILE" <<'JS'
import fs from 'node:fs'
import path from 'node:path'
const [dir, name] = process.argv.slice(2)
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-robot-lab-bundle']
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'package.json')
if (fs.existsSync(file)) {
  const present = JSON.parse(fs.readFileSync(file, 'utf8')).dsh?.profile?.bundles
  if (!Array.isArray(present) || bundles.some((bundle, i) => present.indexOf(bundle) < 0 || i > 0 && present.indexOf(bundle) < present.indexOf(bundles[i - 1]))) {
    throw new Error(`Refusing to overwrite unrelated profile ${dir}; choose another --profile`)
  }
} else {
  fs.writeFileSync(file, JSON.stringify({ name: `dsh-profile-${name}`, private: true, dependencies: {}, dsh: { profile: { bundles } } }, null, 2) + '\n', { flag: 'wx' })
}
const workspace = path.join(dir, 'pnpm-workspace.yaml')
if (!fs.existsSync(workspace)) fs.writeFileSync(workspace, 'packages: []\n', { flag: 'wx' })
JS

echo '==> checking dependencies and loading the MuJoCo model'
printf '%s\n' '{"request":{"operation":"readiness"},"limits":{}}' |
  "$PY" -B packages/robot/robot-lab-microduck/python/bridge.py --source "$LAB" --root "$STATE/preflight" > "$STATE/readiness.json"
node --input-type=module - "$STATE/readiness.json" <<'JS'
import fs from 'node:fs'
const { readiness } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify(readiness, null, 2))
if (readiness?.ready !== true) { console.error('Robot Lab is not ready; fix the reported environment error before booting.'); process.exitCode = 1 }
JS
if [ "$VERIFY" -eq 1 ]; then
  EVIDENCE_DIR="$(mktemp -d "$STATE/verification.XXXXXX")"
  echo '==> real CPU integration verification (not a choreography or hardware certificate)'
  DSH_MICRODUCK_BACKEND=cpu DSH_ROBOT_SMOKE_EVIDENCE="$EVIDENCE_DIR/host-provider.json" pnpm exec vitest run --config vitest.e2e.config.ts packages/robot/robot-lab-microduck/tests/provider.e2e.ts
  [ -s "$EVIDENCE_DIR/host-provider.json" ] || fail 'verification produced no evidence (a skipped test is not success)'
  printf '==> verification evidence: %s/host-provider.json\n' "$EVIDENCE_DIR"
fi
printf '==> profile: %s\n' "$PROFILE_DIR"
echo '==> Robot controls: Teach → Train → Policies → Test. Choose a writable workspace/session.'
echo '==> Hardware activation and cloud training are unavailable; chat credentials are configured separately.'
[ "$RUN" -eq 1 ] || { echo '==> setup complete; no Web server started'; exit 0; }
ARGS=(--profile "$PROFILE" --port "$PORT")
if [ -f "$PROFILE_DIR/cordis.local.patch.yml" ]; then ARGS+=(--patch "$PROFILE_DIR/cordis.local.patch.yml"); fi
printf '==> opening native DSH UI at http://127.0.0.1:%s (Ctrl-C stops this server)\n' "$PORT"
exec pnpm dsh "${ARGS[@]}"
