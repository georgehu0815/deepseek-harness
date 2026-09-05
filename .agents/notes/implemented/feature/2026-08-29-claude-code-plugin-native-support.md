# Agent Note: Native Claude Code plugin support

Status: implemented

English | [中文](2026-08-29-claude-code-plugin-native-support.zh.md)

## Problem

A [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin bundles five kinds of contribution — `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md` subagents, `.mcp.json` MCP servers, and `hooks/hooks.json` — under one plugin root. DeepSeek Harness already has a seam for each: `ctx.skills`, `ctx.commands`, `tool-subagent`, `mcp-client` on `ctx.tools`, and `hooks-claude-code`. What was missing was a way to install a whole plugin the DSH-native way (a bundle added to a profile) without forking the harness or hand-writing a `cordis.yml` per plugin, and to run several plugins at once without their command, tool, and server names colliding.

Two facts constrain the mapping. A Claude Code command is a reusable prompt, but a DSH command does not open a model turn, so a command adapter cannot simply "run" it. And DSH command names must match `/^[a-z][a-z0-9_-]*$/`, so the Claude Code `<plugin>:<name>` colon form is unusable as-is.

## Decision

Native support is one bundle plus one additive core field, no fork.

The additive core field is [`mcp-client` `allowedTools`](../../../../packages/mcp/mcp-client/README.md) (its own [note](2026-08-28-mcp-client-tool-allowlist.md)): a Claude Code server's `tools:` allowlist has no prior expression on `mcp-client`, and filtering at connect keeps disallowed tools out of the registry and the model.

`@deepseek-ai/dsh-cc-commands` in `packages/hooks/cc-commands/` loads `commands/*.md` as `ctx.commands` registrations. Because a DSH command opens no turn, each handler expands the command body — substituting `$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PROJECT_DIR}` — and injects it as a fresh user turn through `invocation.agent.followup(...)`, the same path `command-goal` uses for image attachments. The returned command result is only the UI echo. Command names are coerced to the DSH grammar as `<pluginName>-<file>`, so the model sees `/windows-brain-brain` rather than the rejected `windows-brain:brain`.

`@deepseek-ai/dsh-claude-code-plugin` in `packages/bundle/claude-code-plugin/` is the installable bundle. A DSH profile applies its ordered bundle patches and then its own `cordis.patch.yml`, last-write-wins per row id, so the plugin splits across both layers by necessity:

- The bundle's static `cordis.patch.yml` carries environment-driven defaults keyed on `CC_PLUGIN_ROOT`: `cc-skills` (`skill-filesystem.customSkillDirs`), `cc-commands` (`pluginRoot`), and `cc-hooks` (`hooks-claude-code`, `disabled` unless `hooks/hooks.json` exists).
- The generated profile patch replaces those defaults with literal plugin paths and adds one `mcp-client` row per `.mcp.json` server plus one `tool-subagent` row per agent. `scripts/install.mjs` generates a self-contained single-plugin profile; `scripts/cc-manifest.mjs` generates namespaced rows for several plugins.

Subagents map to `tool-subagent` with no seam change: each agent becomes one `tool-subagent` row whose per-instance `Config` already carries `toolName`, `persona`, `toolFilter`, and `provider`. The agent's `tools:` list maps to `toolFilter.allow` (`Read→read`, `Bash→bash`, …) and its body becomes the persona, so DSH enforces the agent's tool scope through `childCtx.tools.restrict()` rather than by prose.

### Multi-plugin namespacing

Three registries reject cross-plugin duplicates: command names, `tool-subagent` `toolName`, and `mcp-client` `serverName`. A generated single-plugin profile needs no namespacing. For several plugins, `cc-manifest.mjs` prefixes each plugin's command names (via `cc-commands.pluginName`), subagent tool names (`--namespace`), and MCP server names (`--namespace`) with the plugin's name, so the composed profile is collision-free. The windows-brain plugin composed twice under distinct names yields 47 rows with all-unique ids.

### Generators, not runtime loaders, for MCP and subagents

The MCP and subagent rows are emitted as static, reviewable `cordis.yml` rows rather than discovered by a runtime loader. Server launch commands, tool grants, agent personas, and tool scopes then stay visible in the profile and overridable per row, which matches how DSH surfaces deployment-varying configuration.

## Alternatives considered

**Fork the harness / change `agent-loop`.** Rejected: every Claude Code part already has a seam, so new behavior belongs on the extension points, not in the loop. Nothing here required a loop change.

**A runtime MCP/subagent loader that reads the plugin at boot.** Rejected as the first cut: it would hide each server's command, auth, and tool grants and each agent's persona and scope behind code, losing the per-row review and override that generated rows keep. A loader remains a reasonable future addition once the row shape is settled.

**Namespace commands with the Claude Code colon form `<plugin>:<name>`.** Rejected: the DSH command grammar forbids colons. Coercing to `<pluginName>-<file>` keeps names valid and unique.

**One bundle instance per plugin for the multi-plugin case.** Rejected in favor of a single generated profile patch with plugin-namespaced ids: it avoids per-plugin bundle duplication and keeps the whole multi-plugin profile one reviewable file.

**Enforce agent tool limits by prompt text (as Claude Code does).** Rejected: `tool-subagent`'s `toolFilter` enforces the scope in the executor via `restrict()`, which a prompt cannot guarantee.

## Consequences

- A Claude Code plugin installs the DSH-native way: add `dsh-claude-code-plugin` to a profile's bundles, generate the profile patch, and launch the profile normally. Several plugins compose through one manifest without collisions.
- The only shipped core change is the additive `mcp-client` `allowedTools` field; everything else composes existing plugins over `dsh-base`.
- The generated rows are not hot-reloaded: editing a plugin's `.mcp.json` or `agents/` requires re-running the generator. Per-agent `model` and per-agent MCP grants are not yet mapped, and Claude Code `agency`/`authScope` auth is surfaced as a comment rather than translated.

## Related

- [mcp-client tool allowlist](2026-08-28-mcp-client-tool-allowlist.md) — the additive core field this feature relies on.
- [mcp-client plugin](2026-07-07-mcp-client-plugin.md) — the MCP seam the generated rows target.
