# Running a Claude Code plugin on DeepSeek Harness

English | [中文](running-a-claude-code-plugin.zh.md)

This guide shows how to run a [Claude Code](https://docs.claude.com/en/docs/claude-code) (CC) plugin — its skills, commands, subagents, MCP servers, and hooks — natively on DeepSeek Harness (DSH), and documents every file and change that makes it work.

Native support is **one bundle plus one additive core field, no fork**. A CC plugin installs the DSH-native way: add the `dsh-claude-code-plugin` bundle to a profile, generate the per-plugin rows, and launch with the plugin root in the environment.

## What a Claude Code plugin maps to

A CC plugin is a directory (the *plugin root*) with these parts. Each maps to an existing DSH seam:

| Claude Code part | File(s) | DSH seam | Produced row |
|---|---|---|---|
| Skills | `skills/*/SKILL.md` | `ctx.skills` | one `skill-filesystem` row (`cc-skills`) |
| Commands | `commands/*.md` | `ctx.commands` | `cc-commands` (injects the expanded prompt as a turn) |
| Subagents | `agents/*.md` | `tool-subagent` | one `tool-subagent` row per agent (`persona` + `toolFilter`) |
| MCP servers | `.mcp.json` | `mcp-client` on `ctx.tools` | one `mcp-client` row per server (`allowedTools`) |
| Hooks | `hooks/hooks.json` | `hooks-claude-code` | `cc-hooks` (only when the file exists) |

The design rationale, alternatives, and consequences are recorded in the [native Claude Code plugin support Agent Note](../../.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md).

## Quick start (one plugin)

Assume a plugin at `/abs/windows-brain/plugin` and a profile directory `~/.dsh/profiles/wb`.

**1. Generate the per-plugin MCP + subagent rows into the profile.**

```sh
node packages/bundle/claude-code-plugin/scripts/install.mjs \
  /abs/windows-brain/plugin \
  ~/.dsh/profiles/wb \
  --provider spawn
```

This writes `~/.dsh/profiles/wb/cordis.patch.yml` containing one `mcp-client` row per `.mcp.json` server and one `tool-subagent` row per `agents/*.md` file. For windows-brain it reports, for example:

```
wrote ~/.dsh/profiles/wb/cordis.patch.yml
  8 mcp-client row(s), 14 tool-subagent row(s), provider=spawn
  launch with CC_PLUGIN_ROOT=/abs/windows-brain/plugin
```

**2. List the bundles in the profile's `package.json`,** in order — `dsh-base` first, then this bundle:

```json
{
  "name": "dsh-profile-wb",
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-claude-code-plugin"
      ]
    }
  },
  "dependencies": {
    "@deepseek-ai/dsh-base": "workspace:^",
    "@deepseek-ai/dsh-claude-code-plugin": "workspace:^"
  }
}
```

**3. Launch with the plugin root in the environment.** The bundle's static rows read `CC_PLUGIN_ROOT`:

```sh
CC_PLUGIN_ROOT=/abs/windows-brain/plugin dsh --profile wb
```

The skills load, `/windows-brain-<command>` commands work, each agent is a dispatchable subagent tool, and the MCP servers connect. If the plugin ships `hooks/hooks.json`, its command-hook subset runs; otherwise the hooks row stays disabled.

## Multiple plugins

Three DSH registries reject cross-plugin duplicates — command names, subagent `toolName`, and MCP `serverName`. To run several plugins at once, use `cc-manifest.mjs`, which prefixes every name with the plugin's name so nothing collides.

Write a manifest:

```json
{
  "plugins": [
    { "root": "/abs/windows-brain/plugin", "name": "windows-brain" },
    { "root": "/abs/another/plugin",        "name": "another" }
  ],
  "provider": "spawn"
}
```

Generate the combined profile patch:

```sh
node packages/bundle/claude-code-plugin/scripts/cc-manifest.mjs \
  ./manifest.json \
  ~/.dsh/profiles/multi
```

This emits one `cordis.patch.yml` with a single `- insert:` carrying: one shared `cc-skills` row (all plugins' skills dirs), one `cc-commands` row per plugin, one `cc-hooks` row per plugin that ships hooks, and every plugin's namespaced `mcp-client` and `tool-subagent` rows. `name` defaults to the plugin dir basename; `provider` defaults to `spawn`. Because every row id is plugin-namespaced, the whole multi-plugin profile is one collision-free, reviewable file.

## How it works: two patch layers

A DSH profile applies its `dsh.profile.bundles` (ordered static bundle patches) and then its own `cordis.patch.yml`, last-write-wins per row id. A CC plugin splits across both layers **by necessity**: a static patch can express config-only rows but not N per-plugin rows.

- **Bundle patch — static, config-only, keyed on `CC_PLUGIN_ROOT`.** The rows that need only the plugin root, resolved through `!!js` expressions:
  - `cc-skills` → `skill-filesystem` with `customSkillDirs: [<root>/skills]`
  - `cc-commands` → the `cc-commands` plugin with `pluginRoot`
  - `cc-hooks` → `hooks-claude-code`, `disabled` unless `<root>/hooks/hooks.json` exists
- **Profile patch — generated per-plugin rows.** One `mcp-client` row per server and one `tool-subagent` row per agent. Their count and content vary per plugin, so `install.mjs`/`cc-manifest.mjs` generate them as reviewable rows into the profile layer. Server launch commands, tool grants, agent personas, and tool scopes stay visible and overridable per row.

## Reference: every file and change

Everything below is under the repository root `packages/` unless noted.

### New package: `@deepseek-ai/dsh-cc-commands`

Loads `commands/*.md` as DSH commands. A DSH command opens no model turn, so each handler expands the command body (`$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`) and injects it as a fresh user turn through `invocation.agent.followup(...)`.

- `packages/hooks/cc-commands/src/index.ts` — the plugin: `name`, `inject`, `Config`, `apply`, plus the exported loaders `parseFrontmatter`, `expandBody`, `commandName`, `loadCommands`, `buildInjectedMessage`.
- `packages/hooks/cc-commands/src/types.ts` — `CcCommand`, `ExpansionVars`.
- `packages/hooks/cc-commands/src/invariant.ts` — package-owned invariant companion (no runtime invariant; command registrations dispose with the fiber).
- `packages/hooks/cc-commands/package.json` — manifest and dependencies.
- `packages/hooks/cc-commands/tsconfig.json` — project references.
- `packages/hooks/cc-commands/tests/cc-commands.spec.ts` — real-composition test (registers commands on the real `CommandRuntime`, executes one through the executor, asserts the injected prompt) plus the Loader-safe export shape and HMR-disposal.
- `packages/hooks/cc-commands/tests/fixture-plugin/commands/{hello,plain}.md` — test fixtures.
- `packages/hooks/cc-commands/README.md`, `README.zh.md`, `README.i18n.yaml` — bilingual docs and pairing record.

### New bundle: `@deepseek-ai/dsh-claude-code-plugin`

The installable bundle plus the install generators.

- `packages/bundle/claude-code-plugin/cordis.patch.yml` — the static config-only patch (`cc-skills`, `cc-commands`, `cc-hooks`), keyed on `CC_PLUGIN_ROOT`.
- `packages/bundle/claude-code-plugin/scripts/install.mjs` — single-plugin generator: writes the profile `cordis.patch.yml`.
- `packages/bundle/claude-code-plugin/scripts/cc-manifest.mjs` — multi-plugin generator: composes a `pluginRoots[]` manifest with per-plugin namespacing.
- `packages/bundle/claude-code-plugin/scripts/cc-mcp-to-cordis.mjs` — `.mcp.json` → `mcp-client` rows (supports `--namespace`, `--insert`).
- `packages/bundle/claude-code-plugin/scripts/cc-subagents.mjs` — `agents/*.md` → `tool-subagent` rows (supports `--provider`, `--namespace`, `--insert`).
- `packages/bundle/claude-code-plugin/src/index.ts` — bundle module (no runtime API; substance is the patch file).
- `packages/bundle/claude-code-plugin/src/invariant.ts` — invariant companion (static patch carrier).
- `packages/bundle/claude-code-plugin/package.json` — manifest with `dsh.bundle.patch` and the composed plugin dependencies.
- `packages/bundle/claude-code-plugin/tsconfig.json` — project references.
- `packages/bundle/claude-code-plugin/tests/claude-code-plugin.spec.ts` — asserts the patch parses, the `!!js` config-only rows are correct, `install.mjs` produces schema-valid rows, and `cc-manifest.mjs` composes two colliding plugins collision-free.
- `packages/bundle/claude-code-plugin/README.md`, `README.zh.md`, `README.i18n.yaml` — bilingual docs and pairing record.

### The one core change: `mcp-client` `allowedTools`

A CC server's `.mcp.json` `tools:` allowlist had no prior expression on `mcp-client`. The additive field filters tools at connect, so disallowed tools never reach the registry or the model.

- `packages/mcp/mcp-client/src/index.ts` — `allowedTools?: string[]` on both `StdioConfig`/`StreamableHttpConfig`, plus the zod schema field.
- `packages/mcp/mcp-client/src/tools.ts` — the exported `toolAllowed(rawName, allowlist)` predicate (exact, trailing-`*` prefix, lone `*`) applied in `syncTools` before the tool is published.
- `packages/mcp/mcp-client/src/connection.ts` — threads `allowedTools` into the bridge options.
- `packages/mcp/mcp-client/tests/mcp-client.spec.ts` — added `toolAllowed` unit tests and `syncTools` allowlist/absent/HMR tests.
- `packages/mcp/mcp-client/README.md` — the `allowedTools` config row and connect behavior.
- `.agents/notes/implemented/feature/2026-08-28-mcp-client-tool-allowlist.md` (+ `.zh.md`, `.i18n.yaml`) — the Agent Note for this field.

### Wiring and the feature note

- `tsconfig.host.json` — added project references for `packages/hooks/cc-commands` and `packages/bundle/claude-code-plugin`.
- `.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md` (+ `.zh.md`, `.i18n.yaml`) — the feature Agent Note tying the pieces together and cross-linking the `mcp-client` allowlist note.

## Command, tool, and server naming

- **Commands.** DSH command names must match `/^[a-z][a-z0-9_-]*$/`, so the CC `<plugin>:<name>` colon form is unusable. Each command is named `<pluginName>-<file>`, lowercased, with non-conforming characters folded to `-` and a `cc-` prefix when the result would not start with a letter. `pluginName` defaults to the plugin root's basename. So `commands/brain.md` under `pluginName: windows-brain` registers as `/windows-brain-brain`.
- **Subagent tools.** Each agent becomes a `tool-subagent` row whose `toolName` is the agent name (namespaced per plugin in the multi-plugin case). Its `tools:` list maps to `toolFilter.allow` (`Read→read`, `Bash→bash`, `Grep→grep`, `Glob→glob`, `Write→write`, `Edit→edit`, `WebSearch→web_search`), enforced in the executor through `restrict()`, and its body becomes the persona.
- **MCP servers.** Each server becomes an `mcp-client` row whose `serverName` is the `.mcp.json` key (namespaced `<plugin>-<server>` in the multi-plugin case). Its `tools:` becomes `allowedTools`.

## Verification

Both packages ship real-composition tests. From the repository root:

```sh
pnpm -s exec vitest run \
  packages/hooks/cc-commands/tests/ \
  packages/bundle/claude-code-plugin/tests/
```

The `cc-commands` suite boots the real command runtime, executes a command through the executor, and asserts the variable-expanded prompt is injected through `agent.followup`, plus disposal on unload. The bundle suite parses the static patch, validates every generated `mcp-client` and `tool-subagent` row against its shipped `Config`, and proves two colliding plugins compose into one collision-free profile.

## Limitations

- The MCP and subagent rows are generated at install time, not hot-reloaded: re-run the generator after editing a plugin's `.mcp.json` or `agents/`.
- Per-agent `model` and per-agent MCP grants from Claude Code are not yet mapped; a subagent inherits the deployment model and the tool scope its `toolFilter` allows.
- Claude Code auth expressed through `agency`/`authScope` in `.mcp.json` has no DSH counterpart; the generator surfaces it as a comment, and the server's credentials must be supplied through `env`/`headers`.
- Hooks are mounted only from `hooks/hooks.json`; other Claude Code hook locations are not discovered.
