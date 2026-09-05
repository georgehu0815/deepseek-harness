/**
 * @deepseek-ai/dsh-claude-code-plugin — run a Claude Code plugin natively on
 * DeepSeek Harness as a profile bundle. The package's substance is
 * `cordis.patch.yml` (the config-only skills/commands/hooks rows, keyed on the
 * CC_PLUGIN_ROOT environment variable), declared by the `dsh.bundle.patch`
 * manifest field and resolved by the profile composer through that field. The
 * per-plugin MCP and subagent rows are generated into the profile's own patch
 * layer by `scripts/install.mjs` (one plugin) or `scripts/cc-manifest.mjs`
 * (many). This module carries no runtime API.
 * @module @deepseek-ai/dsh-claude-code-plugin
 */

export {}
