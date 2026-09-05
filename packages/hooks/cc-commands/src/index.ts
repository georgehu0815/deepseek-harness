/**
 * cc-commands — load a Claude Code plugin's `commands/*.md` as DeepSeek Harness
 * commands.
 *
 * Each `commands/<name>.md` becomes one `ctx.commands` registration. A Claude
 * Code command is a prompt, not a deterministic action, and a DSH command does
 * not open a model turn itself, so the handler expands the command body and
 * injects it as a fresh user turn through `invocation.agent.followup(...)` — the
 * same path `command-goal` uses. The returned {@link CommandResult} is only the
 * UI echo; the injected message drives the model.
 * @module @deepseek-ai/dsh-cc-commands
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CcCommand, ExpansionVars } from './types.ts'

export type { CcCommand, ExpansionVars } from './types.ts'

/** Cordis plugin name. */
export const name = 'cc-commands'

/** Services required before this plugin can register commands. */
export const inject = ['commands']

/** Config: the Claude Code plugin root and how its commands are namespaced. */
export interface Config {
  /** The plugin root directory; `commands/` and `${CLAUDE_PLUGIN_ROOT}` derive from it. */
  pluginRoot: string
  /**
   * Namespace prefix for command names; defaults to the plugin root's basename.
   * DSH command names must match `/^[a-z][a-z0-9_-]*$/`, so the CC colon form
   * `<plugin>:<name>` is unusable — commands are named `<pluginName>-<file>`.
   */
  pluginName?: string
  /**
   * Value substituted for `${CLAUDE_PROJECT_DIR}`; defaults to the harness
   * working directory captured at load.
   */
  projectDir?: string
}

/** Config schema; `pluginRoot` is required, the rest carry explicit defaults. */
export const Config: z<Config> = z.object({
  pluginRoot: z.string().required(),
  pluginName: z.string(),
  projectDir: z.string(),
})

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*\n?/

/**
 * Split a leading `--- … ---` frontmatter block into `{ data, body }`, tolerant
 * of CRLF. Only the flat `key: value` lines these command files use are read.
 * @param text - the raw file contents.
 * @returns the parsed frontmatter fields and the remaining body.
 */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  const match = FRONTMATTER.exec(normalized)
  if (match === null) return { data: {}, body: normalized }
  const data: Record<string, string> = {}
  for (const line of (match[1] ?? '').split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (kv !== null && kv[1] !== undefined) data[kv[1]] = (kv[2] ?? '').replace(/^["']|["']$/g, '')
  }
  return { data, body: normalized.slice(match[0].length) }
}

/**
 * Expand the Claude Code variables a command body may use.
 * @param body - the raw command body.
 * @param vars - the values to substitute.
 * @returns the body with `$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}`, and
 *   `${CLAUDE_PROJECT_DIR}` replaced.
 */
export function expandBody(body: string, vars: ExpansionVars): string {
  return body
    .replaceAll('$ARGUMENTS', vars.args)
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', vars.pluginRoot)
    .replaceAll('${CLAUDE_PROJECT_DIR}', vars.projectDir)
}

/**
 * Namespace and coerce a command name to the DSH grammar `/^[a-z][a-z0-9_-]*$/`:
 * `<pluginName>-<file>`, lowercased, non-conforming characters folded to `-`,
 * with a `cc-` prefix when the result would not start with a letter.
 * @param pluginName - the namespace prefix.
 * @param base - the command file's basename without extension.
 * @returns a valid DSH command name.
 */
export function commandName(pluginName: string, base: string): string {
  const raw = `${pluginName}-${base}`.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z]/.test(raw) ? raw : `cc-${raw}`
}

/**
 * Load every `commands/*.md` under a Claude Code plugin root.
 * @param pluginRoot - the plugin directory.
 * @param pluginName - the namespace prefix for command names.
 * @returns the loaded command definitions; empty when no `commands/` dir exists.
 */
export function loadCommands(pluginRoot: string, pluginName: string): CcCommand[] {
  const dir = join(pluginRoot, 'commands')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.md'))
    .map((file) => {
      const { data, body } = parseFrontmatter(readFileSync(join(dir, file), 'utf8'))
      const base = basename(file, '.md')
      return {
        name: commandName(pluginName, base),
        description: data.description ?? `Claude Code command ${base}`,
        ...data['argument-hint'] !== undefined ? { argumentHint: data['argument-hint'] } : {},
        body,
      }
    })
}

/**
 * Build the user message a command handler injects: the expanded prompt as a
 * fresh user turn. Pure and testable — no agent, no registry.
 * @param command - the loaded command.
 * @param rawInput - the invocation text after the command name.
 * @param vars - the plugin and project roots for variable expansion.
 * @returns the frozen user message to pass to `agent.followup`.
 */
export function buildInjectedMessage(
  command: CcCommand,
  rawInput: string,
  vars: { pluginRoot: string; projectDir: string },
): ReturnType<typeof createUserMessage> {
  const text = expandBody(command.body, {
    args: rawInput.trim(),
    pluginRoot: vars.pluginRoot,
    projectDir: vars.projectDir,
  })
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/**
 * Register each loaded Claude Code command on `ctx.commands`. Each handler
 * injects its expanded body as a new turn and returns a short UI echo.
 * @param ctx - the plugin context carrying `ctx.commands`.
 * @param config - the plugin root and namespacing.
 */
export function apply(ctx: Context, config: Config): void {
  const pluginRoot = config.pluginRoot
  const pluginName = config.pluginName ?? basename(pluginRoot)
  const projectDir = config.projectDir ?? process.cwd()
  const commands = loadCommands(pluginRoot, pluginName)

  for (const command of commands) {
    ctx.commands.register({
      name: command.name,
      description: command.description,
      ...command.argumentHint !== undefined ? { input: { hint: command.argumentHint } } : {},
      handler: (invocation: CommandInvocation): CommandResult => {
        invocation.agent.followup(
          buildInjectedMessage(command, invocation.rawInput, { pluginRoot, projectDir }),
        )
        return { kind: 'success', text: `Running /${command.name}` }
      },
    })
  }
}
