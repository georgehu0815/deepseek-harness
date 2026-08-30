# Cookbook: recovering an interrupted pnpm install

English | [中文](recovering-an-interrupted-pnpm-install.zh.md)

Use this procedure when `pnpm install` reports `ERR_PNPM_OUTDATED_LOCKFILE` and a later command reports a missing module. It restores the workspace without discarding source changes or editing generated installation data by hand.

## Diagnose the failure

`ERR_PNPM_OUTDATED_LOCKFILE` is the primary failure when a workspace package manifest has changed but its importer in `pnpm-lock.yaml` is stale. A frozen install refuses to resolve different dependency inputs because CI and local installs must use the same declared graph.

A missing module reported afterward is usually a secondary symptom. pnpm can begin rebuilding `node_modules` before it stops, leaving the installation tree incomplete even though the lockfile still describes the earlier workspace inputs.

Preserve all staged and unstaged work. Do not reset `pnpm-lock.yaml`, delete `node_modules`, hand-edit generated lockfile entries, or create a manual symlink for the missing module.

## 1. Regenerate the lockfile

When the configured registry is reachable, regenerate only the lockfile:

```sh
pnpm install --lockfile-only --no-frozen-lockfile
```

Inspect the generated change before rebuilding dependencies:

```sh
git diff -- pnpm-lock.yaml
```

The importer for each changed workspace package must contain its declared dependencies and the expected `link:` targets for workspace packages. Let pnpm update all related resolution and snapshot entries instead of editing them by hand.

## 2. Restore dependencies

Rebuild the installation tree from the accepted lockfile:

```sh
pnpm install --frozen-lockfile
```

The frozen install now verifies the regenerated dependency graph while restoring packages and links that the interrupted install may have left missing.

## Recover from the local cache

Use offline mode when registry access fails and the local pnpm store already contains the required package metadata and content:

```sh
pnpm install --lockfile-only --no-frozen-lockfile --offline
pnpm install --frozen-lockfile --offline
```

If Corepack cannot launch pnpm on macOS, read the repository's pinned version and invoke its cached executable through Node.js:

```sh
pnpm_version=$(node -p \
  "require('./package.json').packageManager.split('@').at(-1)")
pnpm_cjs=$(find "$HOME/Library/pnpm/.tools/pnpm/$pnpm_version" \
  -path '*/node_modules/pnpm/bin/pnpm.cjs' -print -quit)
test -n "$pnpm_cjs"

node "$pnpm_cjs" install \
  --lockfile-only --no-frozen-lockfile --offline
node "$pnpm_cjs" install --frozen-lockfile --offline
```

An offline resolution error means the cache lacks required metadata or content. Restore registry access instead of weakening frozen-lockfile or supply-chain checks.

## Verify the repair

Confirm that CI accepts the lockfile, the generated diff is valid, and the affected package passes its focused check:

```sh
CI=true pnpm install
git diff --check -- pnpm-lock.yaml
pnpm run typecheck
```

Inspect `pnpm-lock.yaml` and confirm that every added or changed workspace package has an importer. A package added under a workspace glob joins dependency resolution immediately; committing its manifest without the generated importer makes the next frozen install fail.

For a `PI_AI_ERROR` that names `anthropic-messages.js`, verify the restored package and run the adapter tests:

```sh
test -f packages/llm/llm-pi-ai/node_modules/\
@earendil-works/pi-ai/dist/api/anthropic-messages.js
pnpm exec vitest run \
  packages/llm/llm-pi-ai/tests/adapter.spec.ts
```

Rerun the command that originally reported the missing module. `Lockfile is up to date` and `Already up to date` confirm that the frozen resolver accepts the dependency graph and that the installation tree is restored.

Warnings about unsupported Linux packages on macOS or cyclic workspace dependencies are informational unless pnpm exits unsuccessfully or reports a dependency-resolution error.

## Why the two phases work

The importers in `pnpm-lock.yaml` are the authority for the workspace's declared dependency graph. Regenerating them first makes the package manifests and lockfile agree before installation state changes again.

`node_modules` is installation state, not the dependency source of truth. Rebuilding it from the accepted graph restores the complete tree; repairing one file or symlink can mask a wider inconsistency.
