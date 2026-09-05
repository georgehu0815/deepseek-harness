# Running the windows-brain profile on DeepSeek Harness

This guide walks you through running the [windows-brain](https://github.com/) Claude Code plugin natively on DeepSeek Harness (DSH) and using it from the Web UI. windows-brain is a Windows quality-investigation orchestrator — the CAR pattern (Collect / Analyze / Review) over Microsoft MCP servers, dispatching expert subagents across a chained investigation.

Everything is driven by one script at the repository root: [`run-windows-brain.sh`](run-windows-brain.sh).

- [What you get](#what-you-get)
- [Prerequisites](#prerequisites)
- [Local implementation map](#local-implementation-map)
- [Quick start](#quick-start)
- [Using it from the Web UI](#using-it-from-the-web-ui)
- [The commands](#the-commands)
- [Everyday workflow: rebuild, reload, rerun](#everyday-workflow-rebuild-reload-rerun)
- [How it is wired](#how-it-is-wired)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

## What you get

Running the profile mounts the whole plugin into a DSH Web session:

- **21 slash commands**, exposed as `/windows-brain-<name>` (for example `/windows-brain-wqd-daily`, `/windows-brain-qr360`, `/windows-brain-watson-anomaly`).
- **14 subagents** — expert auditors plus an adversarial reviewer — dispatchable as tools (`brain`, `watson-crash-analyst`, `driver-reliability-auditor`, `findings-reviewer`, …).
- **8 MCP servers** — `watson`, `kusto`, `starrocks`, `wexp`, `ado`, `bluebird`, `icm-mcp`, `titan` — connected through DSH's MCP client, with each server's tool allowlist enforced.
- **30 skills** — the composable investigation steps, loaded from the plugin's `skills/` directory.

## Prerequisites

- A DeepSeek Harness checkout with dependencies installed (`pnpm install`), Node `^22.19 || >=24`.
- The windows-brain plugin on disk. The default location is `/Users/ghu/work/windows-brain-agent-harness/brainagentharness/plugin`; override it with `PLUGIN_ROOT` (see [Configuration](#configuration)).
- A `DEEPSEEK_API_KEY` in your environment or the repo's `.env`, so the model can run.
- The `agency` CLI (and any credentials it needs) available on your `PATH`, because the MCP servers launch through it. Servers you are not signed in to simply fail to connect; the rest still work.

## Local implementation map

The local profile combines native Claude Code plugin support with Brain Workbench branding. Each behavior has one source owner:

| Behavior | Source owner |
|---|---|
| Build, profile scaffolding, generated plugin rows, and launch | [`run-windows-brain.sh`](run-windows-brain.sh) |
| ESM-safe plugin path and file resolution | [`packages/bundle/claude-code-plugin/cordis.patch.yml`](packages/bundle/claude-code-plugin/cordis.patch.yml) |
| Shared Lucide brain component | [`packages/client/ui-primitives/src/index.ts`](packages/client/ui-primitives/src/index.ts) |
| `Brain Workbench` sidebar label and 24px brain fallback | [`packages/client/ui-sidebar/src/client/SidebarRoot.tsx`](packages/client/ui-sidebar/src/client/SidebarRoot.tsx) |
| 34px brain fallback beside `Into the Unknown` and `Preview` | [`packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx`](packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx) |
| Hero mark layout and hover animation | [`packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`](packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css) |

Both brain marks render the `BrainIcon` export from UI primitives. The sidebar and conversation retain independent `sidebar.brand.mark` and `conversation.hero.brand.mark` slots, so another bundle can replace either fallback without changing these components.

Cordis evaluates the Claude Code bundle's `!!js` expressions as ESM. The bundle obtains `node:path` and `node:fs` through `process.getBuiltinModule(...)`; using CommonJS `require(...)` there fails during profile boot because `require` is undefined.

The browser loads built `lib/` entries rather than the TypeScript source directly. After changing a shared client package, rebuild the client dependency graph before the leaf bundles and Web assets:

```sh
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-client-ui-sidebar run bundle
pnpm --filter @deepseek-ai/dsh-client-ui-conversation run bundle
pnpm run build:web
```

The full `./run-windows-brain.sh` command performs the required repository build. Reserve `--no-build` for restarts where no DSH source or dependency changed.

## Quick start

From the repository root:

```sh
./run-windows-brain.sh
```

The first run does four things, in order:

1. **Builds** the affected packages so their runtime code exists.
2. **Scaffolds** a dedicated profile at `~/.dsh/profiles/windows-brain`.
3. **Generates** one MCP row per server and one subagent row per agent into that profile.
4. **Launches** the Web UI at `http://127.0.0.1:3080` with the plugin mounted.

When it prints the launch line, open **http://127.0.0.1:3080** in your browser.

## Using it from the Web UI

1. Open http://127.0.0.1:3080.
2. In the message box, type `/` to see the command list, or type a command directly.
3. Run a command, for example:

   ```
   /windows-brain-wqd-daily
   ```

   The command's prompt is injected as your turn, and the model proceeds — calling the plugin's skills, dispatching subagents, and querying the MCP servers as the investigation requires.
4. Commands that take input accept it inline after the command name; the text you type replaces the command's `$ARGUMENTS`:

   ```
   /windows-brain-watson-anomaly last 7 days, Explorer.exe
   ```

The same works in any DSH app that renders commands (for instance the desktop app pointed at this profile), not only the browser.

## The commands

All 21 commands, as they appear in the UI:

| Command | Command | Command |
|---|---|---|
| `/windows-brain-brain` | `/windows-brain-qr360` | `/windows-brain-qr360-daily` |
| `/windows-brain-wqd-daily` | `/windows-brain-wqd-rca` | `/windows-brain-wqd-bug-portfolio` |
| `/windows-brain-watson-anomaly` | `/windows-brain-driver-anomaly` | `/windows-brain-event-anomaly` |
| `/windows-brain-app-anomaly` | `/windows-brain-app-regression` | `/windows-brain-dsat-app-crash` |
| `/windows-brain-asimov-anomaly` | `/windows-brain-asimov-wqd-triage` | `/windows-brain-cfe-reliability-search` |
| `/windows-brain-devbox-brain` | `/windows-brain-interruption-rate` | `/windows-brain-kb2kb-reliability` |
| `/windows-brain-readiness-vs-wir` | `/windows-brain-reliability-readiness` | `/windows-brain-uaqi` |

`/windows-brain-brain` is the top-level orchestrator; the rest are targeted investigations. Each command's exact behavior is defined by the plugin, not by DSH.

## Everyday workflow: rebuild, reload, rerun

The script is idempotent, so re-running it is always safe. Use the flags to skip the parts you do not need:

```sh
./run-windows-brain.sh              # full rebuild + reload + run
./run-windows-brain.sh --no-build   # skip the build; reload the profile and run
./run-windows-brain.sh --rows-only  # only regenerate the plugin's rows, then run
./run-windows-brain.sh --no-run     # rebuild and refresh the profile without launching
```

After the script has generated the profile once, you can launch it directly on any port:

```sh
dsh --profile windows-brain --port 3088
```

- **After editing DSH code** (the harness itself): run the full `./run-windows-brain.sh` so `lib/` is rebuilt, then refresh the browser.
- **After editing the plugin's `.mcp.json` or `agents/`**: run `./run-windows-brain.sh --rows-only` to regenerate the rows, then refresh.
- **After editing the plugin's `commands/` or `skills/`**: no regeneration is needed because the generated profile stores their directories and reads their contents at boot; restart the run with `--no-build`.

The script prints the URL it serves. Refresh that page after any restart; a new tab on the same URL picks up the reloaded profile.

## How it is wired

The profile at `~/.dsh/profiles/windows-brain` stacks three bundles in order:

```
@deepseek-ai/dsh-base            # the core harness
@deepseek-ai/dsh-web-app         # the Web UI
@deepseek-ai/dsh-claude-code-plugin   # the native Claude Code plugin support
```

The Claude Code bundle contributes the plugin across two layers:

- **Static bundle defaults, keyed on `CC_PLUGIN_ROOT`** — fallback rows for the skills directory, command loader, and hooks bridge before profile generation.
- **Generated profile rows** — literal paths for skills, commands, and hooks, one MCP client row per server, and one subagent row per agent. The script writes these into the profile's own `cordis.patch.yml`, so later direct launches need no environment variable.

The full mechanism, including the file-by-file reference, is in the cookbook guide [Running a Claude Code plugin on DeepSeek Harness](docs/cookbook/running-a-claude-code-plugin.md).

## Configuration

Set these as environment variables before the script, or use the matching flag:

| Variable | Flag | Default | Meaning |
|---|---|---|---|
| `PLUGIN_ROOT` | `--plugin <dir>` | the windows-brain path | the Claude Code plugin directory |
| `PROFILE_NAME` | `--profile <name>` | `windows-brain` | the DSH profile directory name |
| `PORT` | `--port <n>` | `3080` | the Web UI listen port |
| `PROVIDER` | — | `spawn` | the subagent execution provider |
| `DSH_HOME` | — | `~/.dsh` | where DSH keeps profiles and data |

For example, to run a different plugin on port 3090:

```sh
PLUGIN_ROOT=/abs/other/plugin ./run-windows-brain.sh --port 3090
```

## Troubleshooting

- **A command is not in the list.** Refresh the generated paths and rows with `./run-windows-brain.sh --no-build`; then use either the script or `dsh --profile windows-brain --port <n>`.
- **An MCP server shows as failed / its tools are missing.** That server did not connect — usually `agency` is missing from `PATH` or you are not authenticated to that backend. The other servers and all commands still work; sign in and restart.
- **A frozen install reports `ERR_PNPM_OUTDATED_LOCKFILE`, followed by `PI_AI_ERROR` or another missing module.** Follow [Recovering an interrupted pnpm install](docs/cookbook/recovering-an-interrupted-pnpm-install.md). Reconcile the lockfile before restoring `node_modules`; do not repair the missing file or symlink by hand.
- **A subagent tool is missing after editing `agents/`.** Regenerate the rows: `./run-windows-brain.sh --rows-only`.
- **The build step stalls on a dependency install.** If `pnpm install` is blocked by a registry-mirror check, run `pnpm install` once in an environment without that mismatch, then use `./run-windows-brain.sh --no-build` for subsequent runs.
- **Port already in use.** Pass `--port <n>` (or `--port 0` to let the OS choose a free port).
- **React error 130 reports an undefined component in `sidebar` or `conversation`.** The leaf bundles reference a client primitive that is absent from stale `lib/` output. Run the four commands in [Local implementation map](#local-implementation-map), restart the profile with `./run-windows-brain.sh --no-build`, and refresh the browser. The served `assets/index-*.js` hash should change.
- **Nothing loads / white screen.** Make sure you opened the exact URL the script printed and refreshed after the restart; a stale tab from a previous port will not pick up the new profile.
