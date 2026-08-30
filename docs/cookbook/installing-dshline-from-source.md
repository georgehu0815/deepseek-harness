# Cookbook: installing dshline from source

English | [中文](installing-dshline-from-source.zh.md)

Use this procedure when both DeepSeek Harness and dshline contain local changes that are not available from npm. The resulting `dsh` command runs the Harness checkout, and the `dshline` profile loads the compiled plugin from the dshline checkout.

## Outcome

The installation has two persistent links:

1. The global `dsh` package points at `deepseek-harness/apps/cli`.
2. `$DSH_HOME/profiles/dshline` declares `@dshline/dshline` with a `link:` path to `dshline/packages/dshline`.

The profile remains pnpm-managed. The dshline package's `dsh.bundle.patch` declaration adds its `cordis.patch.yml` to the profile's Bundle list.

## 1. Set the checkout paths

Use absolute paths so profile installation does not depend on the current directory:

```sh
export HARNESS_ROOT=/Volumes/ExternalSSD/geoagent/deepseek-harness
export DSHLINE_ROOT=/Volumes/ExternalSSD/geoagent/dshline
```

Both projects require Node.js `^22.19 || >=24`.

## 2. Build and expose the local Harness

Build the Harness and install its local CLI link:

```sh
cd "$HARNESS_ROOT"
./install-dsh-global.sh
```

Confirm that the global package resolves to this checkout rather than the npm registry installation:

```sh
dsh --version
realpath "$(npm root --global)/@deepseek-ai/dsh"
```

The version must match `apps/cli/package.json`, and the resolved path must end in `deepseek-harness/apps/cli`. Run `pnpm dsh` from `$HARNESS_ROOT` instead when a global command is unnecessary.

## 3. Build dshline

The ordinary source build is:

```sh
cd "$DSHLINE_ROOT"
pnpm install
pnpm build
```

Both compiled entries must exist:

```sh
test -f packages/renderer/lib/index.js
test -f packages/dshline/lib/index.js
```

### Fallback for unavailable Harness prereleases

A dshline branch may pin a Harness prerelease that the configured registry cannot resolve. The failure names a package such as `@deepseek-ai/dsh-agent-default-model@0.1.1-rc.2` and occurs before TypeScript runs.

When the local Harness checkout provides the required APIs, link dshline's ignored `node_modules` entries to that checkout and compile with the Harness TypeScript installation:

```bash
set -euo pipefail

plugin_modules="$DSHLINE_ROOT/packages/dshline/node_modules"
root_modules="$DSHLINE_ROOT/node_modules"
mkdir -p \
  "$plugin_modules/@deepseek-ai" \
  "$plugin_modules/@dshline" \
  "$plugin_modules/@types" \
  "$root_modules/@types"

ln -sfn "$DSHLINE_ROOT/packages/renderer" \
  "$plugin_modules/@dshline/renderer"

while IFS= read -r manifest; do
  package_name=$(node -p \
    "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).name" \
    "$manifest")
  if [[ "$package_name" == @deepseek-ai/* ]]; then
    ln -sfn "$(dirname "$manifest")" "$plugin_modules/$package_name"
  fi
done < <(find "$HARNESS_ROOT/vendor" "$HARNESS_ROOT/packages" \
  -path '*/node_modules' -prune -o -name package.json -print)

yaml_dir=$(dirname "$(find "$HARNESS_ROOT/node_modules/.pnpm" \
  -path '*/node_modules/yaml/package.json' -print -quit)")
commander_dir=$(dirname "$(find "$HARNESS_ROOT/node_modules/.pnpm" \
  -path '*/node_modules/commander/package.json' -print -quit)")
node_types="$HARNESS_ROOT/node_modules/@types/node"

ln -sfn "$yaml_dir" "$plugin_modules/yaml"
ln -sfn "$commander_dir" "$plugin_modules/commander"
ln -sfn "$node_types" "$plugin_modules/@types/node"
ln -sfn "$node_types" "$root_modules/@types/node"

node "$HARNESS_ROOT/node_modules/typescript/bin/tsc" \
  -b "$DSHLINE_ROOT/tsconfig.json"
```

This fallback writes only ignored dependency links and compiled `lib/` artifacts. It does not change either package manifest. A TypeScript error after the links resolve indicates an API incompatibility between the two checkouts and must be fixed in source.

## 4. Install the local plugin into a profile

Pass the package directory, not the monorepo root and not the npm package name:

```sh
dsh plugin --profile dshline add \
  "$DSHLINE_ROOT/packages/dshline"
```

The absolute directory spec becomes a pnpm `link:` dependency. In contrast, this command downloads the registry release and does not use local changes:

```sh
dsh plugin --profile dshline add @dshline/dshline
```

## 5. Verify activation

Inspect the installed dependency and composed config:

```sh
dsh plugin --profile dshline list --depth 0
dsh --profile dshline --dump-config | \
  grep -E -A4 -B1 'id: dshline($|-startup)|name: .@dshline/dshline'
```

The dependency must contain `link:` followed by the local package path. The config must contain both `dshline-startup` and `dshline` rows.

Start the terminal interface from a real terminal:

```sh
dsh --profile dshline
```

The interface rejects redirected input or output because it requires a TTY.

## Update or remove the link

Rebuild after every dshline source change because the profile loads `lib/`, not `src/`:

```sh
cd "$DSHLINE_ROOT"
pnpm build
dsh --profile dshline
```

Re-run the fallback compiler from step 3 when the ordinary build remains blocked by unavailable prereleases. Re-run `dsh plugin add` only when the package path or Bundle metadata changes.

Remove the package from the profile with:

```sh
dsh plugin --profile dshline remove @dshline/dshline
```

This leaves the profile's settings and saved Sessions in place.
