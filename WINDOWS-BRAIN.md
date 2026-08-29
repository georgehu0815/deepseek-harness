# Running the windows-brain profile on DeepSeek Harness

This guide walks you through running the [windows-brain](https://github.com/) Claude Code plugin natively on DeepSeek Harness (DSH) and using it from the Web UI. windows-brain is a Windows quality-investigation orchestrator — the CAR pattern (Collect / Analyze / Review) over Microsoft MCP servers, dispatching expert subagents across a chained investigation.

Everything is driven by one script at the repository root: [`run-windows-brain.sh`](run-windows-brain.sh).

- [What you get](#what-you-get)
- [Prerequisites](#prerequisites)
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

- **After editing DSH code** (the harness itself): run the full `./run-windows-brain.sh` so `lib/` is rebuilt, then refresh the browser.
- **After editing the plugin's `.mcp.json` or `agents/`**: run `./run-windows-brain.sh --rows-only` to regenerate the rows, then refresh.
- **After editing the plugin's `commands/` or `skills/`**: no regeneration is needed — those are read live from `CC_PLUGIN_ROOT` on boot; just restart the run (`--no-build`).

The script prints the URL it serves. Refresh that page after any restart; a new tab on the same URL picks up the reloaded profile.

## How it is wired

The profile at `~/.dsh/profiles/windows-brain` stacks three bundles in order:

```
@deepseek-ai/dsh-base            # the core harness
@deepseek-ai/dsh-web-app         # the Web UI
@deepseek-ai/dsh-claude-code-plugin   # the native Claude Code plugin support
```

The Claude Code bundle contributes the plugin across two layers:

- **Static, keyed on `CC_PLUGIN_ROOT`** — the skills directory, the command loader, and the (disabled, since windows-brain ships none) hooks bridge.
- **Generated per-plugin rows** — one MCP client row per server and one subagent row per agent, written by the script into the profile's own `cordis.patch.yml`.

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

- **A command is not in the list.** Confirm the profile launched from this script (not a plain `dsh web`) and that `CC_PLUGIN_ROOT` pointed at the plugin. Restart with `./run-windows-brain.sh --no-build`.
- **An MCP server shows as failed / its tools are missing.** That server did not connect — usually `agency` is missing from `PATH` or you are not authenticated to that backend. The other servers and all commands still work; sign in and restart.
- **A subagent tool is missing after editing `agents/`.** Regenerate the rows: `./run-windows-brain.sh --rows-only`.
- **The build step stalls on a dependency install.** If `pnpm install` is blocked by a registry-mirror check, run `pnpm install` once in an environment without that mismatch, then use `./run-windows-brain.sh --no-build` for subsequent runs.
- **Port already in use.** Pass `--port <n>` (or `--port 0` to let the OS choose a free port).
- **Nothing loads / white screen.** Make sure you opened the exact URL the script printed and refreshed after the restart; a stale tab from a previous port will not pick up the new profile.
