# @deepseek-ai/dsh-claude-code-plugin

English | [中文](README.zh.md)

Run a [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin — its skills, commands, subagents, MCP servers, and hooks — natively on DeepSeek Harness as a [profile bundle](../README.md). The bundle composes shipped plugins over [`dsh-base`](../base/README.md); the only DSH core change it relies on is the additive [`mcp-client` `allowedTools`](../../mcp/mcp-client/README.md) field. Design decisions live in the [Agent Note](../../../.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md).

## Two patch layers, by necessity

A DSH profile applies its `dsh.profile.bundles` (ordered static bundle patches) and then its own `cordis.patch.yml`, last-write-wins per row id. This bundle splits the plugin across both layers, because a static patch expresses config-only rows but not N per-plugin rows:

- **Bundle patch (`cordis.patch.yml`) — static, environment-driven defaults keyed on `CC_PLUGIN_ROOT`:**
  - `cc-skills` → [`skill-filesystem`](../../skill/skill-filesystem/README.md) with `customSkillDirs: [<root>/skills]`
  - `cc-commands` → [`cc-commands`](../../hooks/cc-commands/README.md) with `pluginRoot`
  - `cc-hooks` → [`hooks-claude-code`](../../hooks/hooks-claude-code/README.md), `disabled` unless `<root>/hooks/hooks.json` exists
- **Profile patch (generated) — concrete plugin config plus per-plugin rows:** `scripts/install.mjs` replaces the bundle defaults with literal paths for skills, commands, and hooks. It also generates one [`mcp-client`](../../mcp/mcp-client/README.md) row per `.mcp.json` server and one [`tool-subagent`](../../subagent/tool-subagent/README.md) row per `agents/*.md`. `scripts/cc-manifest.mjs` generates the corresponding namespaced rows for several plugins.

## Install

One plugin:

```sh
# 1. generate the per-plugin MCP + subagent rows into the profile
node scripts/install.mjs <pluginRoot> <profileDir> [--provider spawn]

# 2. the profile's package.json dsh.profile.bundles lists, in order:
#      ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-claude-code-plugin"]

# 3. launch; the generated profile already contains the plugin paths
dsh --profile <name>
```

Many plugins, via a manifest — every row is plugin-namespaced so commands, subagent tool names, and MCP server names never collide:

```sh
node scripts/cc-manifest.mjs <manifest.json> <profileDir>
```

```json
{
  "plugins": [
    { "root": "/abs/windows-brain/plugin", "name": "windows-brain" },
    { "root": "/abs/another/plugin",        "name": "another" }
  ],
  "provider": "spawn"
}
```

## What each Claude Code part becomes

| Claude Code part | DSH seam | Row |
|---|---|---|
| `skills/*/SKILL.md` | `ctx.skills` | one shared `skill-filesystem` row (`cc-skills`) |
| `commands/*.md` | `ctx.commands` | `cc-commands` (injects the expanded prompt as a turn) |
| `agents/*.md` | `tool-subagent` | one `tool-subagent` row per agent, with `persona` + `toolFilter` |
| `.mcp.json` servers | `mcp-client` on `ctx.tools` | one `mcp-client` row per server, with `allowedTools` |
| `hooks/hooks.json` | `hooks-claude-code` | `cc-hooks` (only when the file exists) |

## Namespacing and collisions

Three registries reject cross-plugin duplicates: command names, `tool-subagent` `toolName`, and `mcp-client` `serverName`. A generated single-plugin profile needs no namespacing. For multiple plugins, `cc-manifest.mjs` prefixes command names (via `cc-commands.pluginName`), subagent tool names, and MCP server names with each plugin's name, so the composed profile is collision-free.

## Model experience

The bundle adds no model-facing text of its own. Each composed row's package owns its model experience: `cc-commands` injects the expanded command prompt as an ordinary user turn; `tool-subagent` exposes each agent as a dispatchable tool with its persona and tool scope; `mcp-client` publishes the server's allowed tools. Every part stays reviewable in the session log.

## Known Limitations and Deferred Work

- The MCP and subagent rows are generated at install time, not hot-reloaded: re-run the generator after editing a plugin's `.mcp.json` or `agents/`.
- Per-agent `model` and per-agent MCP grants from Claude Code are not yet mapped; a subagent inherits the deployment model and the tool scope its `toolFilter` allows.
- Claude Code auth expressed through `agency`/`authScope` in `.mcp.json` has no DSH counterpart; the generator surfaces it as a comment and the server's credentials must be supplied through `env`/`headers`.
- Hooks are mounted only from `hooks/hooks.json`; other Claude Code hook locations are not discovered.
