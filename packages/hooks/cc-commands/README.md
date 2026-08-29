# @deepseek-ai/dsh-cc-commands

English | [中文](README.zh.md)

Load a [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin's `commands/*.md` as DeepSeek Harness commands through [`ctx.commands`](../../interaction/commands/README.md). A Claude Code command is a reusable prompt, not a deterministic action, and a DSH command does not open a model turn itself, so each handler expands the command body and injects it as a fresh user turn through `invocation.agent.followup(...)` — the same path [`command-goal`](../../goal/command-goal/README.md) uses for image attachments. The returned command result is only the UI echo; the injected message drives the model.

The native Claude Code plugin support decisions live in the [Agent Note](../../../.agents/notes/implemented/feature/2026-08-29-claude-code-plugin-native-support.md).

## What it loads

Each `commands/<file>.md` becomes one command:

| Source | Becomes |
|---|---|
| frontmatter `description` | command description (falls back to `Claude Code command <file>`) |
| frontmatter `argument-hint` | the command's composer `input.hint` |
| body | the prompt injected on invocation, after variable expansion |

The body may use the Claude Code variables `$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PROJECT_DIR}`; all three are substituted before injection. No other frontmatter keys are read.

## Command naming

DSH command names must match `/^[a-z][a-z0-9_-]*$/`, so the Claude Code `<plugin>:<name>` colon form is unusable. Each command is named `<pluginName>-<file>`, lowercased, with any non-conforming character folded to `-` and a `cc-` prefix added when the result would not begin with a letter. `pluginName` defaults to the plugin root's basename. With `pluginName: windows-brain`, `commands/brain.md` registers as `/windows-brain-brain`.

## Config

| Key | Required | Default | Meaning |
|---|---|---|---|
| `pluginRoot` | yes | — | The Claude Code plugin root; `commands/` and `${CLAUDE_PLUGIN_ROOT}` derive from it. |
| `pluginName` | no | basename of `pluginRoot` | Namespace prefix for command names. |
| `projectDir` | no | harness working directory at load | Value substituted for `${CLAUDE_PROJECT_DIR}`. |

Misconfiguration fails loud: `pluginRoot` is required at load. A missing `commands/` directory registers nothing rather than throwing, so a plugin without commands composes cleanly.

## Model experience

The model never sees the command file. It sees, in ordinary session history, one new user turn carrying the expanded prompt — indistinguishable from a user typing that prompt. This keeps every Claude Code command reviewable in the log and lets later turns read its full text without any command-specific state.

## Composition

The plugin injects `commands`. A profile mounts the command runtime and this plugin, typically once per Claude Code plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'

- id: cc-commands
  name: '@deepseek-ai/dsh-cc-commands'
  config:
    pluginRoot: /abs/windows-brain/plugin
    pluginName: windows-brain
```

For a whole plugin (commands, subagents, MCP servers, skills, hooks) at once, use the [`dsh-claude-code-plugin`](../../bundle/claude-code-plugin/README.md) bundle, which mounts this plugin among the others.

## Known Limitations and Deferred Work

- Only the flat frontmatter keys `description` and `argument-hint` are read; nested YAML and other keys are ignored.
- Command names are namespaced but not otherwise deduplicated: two plugins that would both produce `<name>` must be given distinct `pluginName` values (the bundle and `cc-manifest` do this automatically).
- The three documented variables are expanded; other `${…}` sequences pass through verbatim.
