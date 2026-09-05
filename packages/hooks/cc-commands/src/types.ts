/**
 * Types for `@deepseek-ai/dsh-cc-commands`.
 * @module @deepseek-ai/dsh-cc-commands/types
 */

/** One loaded Claude Code command definition. */
export interface CcCommand {
  /** DSH command name: `<pluginName>-<file>` in the DSH command grammar. */
  readonly name: string
  /** Human-readable summary from frontmatter `description`. */
  readonly description: string
  /** Optional composer placeholder from frontmatter `argument-hint`. */
  readonly argumentHint?: string
  /** The prompt body after the frontmatter block. */
  readonly body: string
}

/** The values substituted into a command body during expansion. */
export interface ExpansionVars {
  /** Text after the command name; substituted for `$ARGUMENTS`. */
  readonly args: string
  /** The plugin root; substituted for `${CLAUDE_PLUGIN_ROOT}`. */
  readonly pluginRoot: string
  /** The project directory; substituted for `${CLAUDE_PROJECT_DIR}`. */
  readonly projectDir: string
}
