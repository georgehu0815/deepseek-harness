#!/usr/bin/env node
/**
 * cc-subagents — translate a Claude Code plugin's `agents/*.md` into DeepSeek
 * Harness `tool-subagent` rows. Build-order step 4 of native CC plugin support
 * (see CC-PLUGIN-NATIVE-SUPPORT-DESIGN.md §4.2).
 *
 * Each `agents/<name>.md` becomes one `@deepseek-ai/dsh-tool-subagent` row:
 *   - `toolName`  <- the agent name, coerced to the tool-name grammar
 *   - `persona`   <- the agent's Markdown body (its system prompt)
 *   - `toolFilter.allow` <- the frontmatter `tools:` list, each CC tool mapped
 *                           to its DSH tool name; omitted `tools` => no filter
 *                           (child keeps the deployment roster)
 *   - `provider`  <- a shared provider (default `spawn`) with the persona +
 *                    toolFilter capabilities
 *
 * The subagent seam is unchanged: `tool-subagent` already accepts per-instance
 * `toolName` / `persona` / `toolFilter`. One row per agent is the design's
 * recommended dispatch-by-name shape.
 *
 * Usage:
 *   node cc-subagents.mjs <pluginRoot-or-agentsDir> [--provider spawn] [--insert]
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/** CC tool name -> DSH tool name. CC tools absent here have no DSH counterpart. */
const TOOL_MAP = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Bash: 'bash',
  Grep: 'grep',
  Glob: 'glob',
  WebSearch: 'web_search',
  WebFetch: 'web_fetch',
}

/** Coerce a name to the DeepSeek function-name grammar `[a-z0-9_-]`, <=64. */
function toolName(name) {
  const raw = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  const named = /^[a-z]/.test(raw) ? raw : `cc-${raw}`
  return named.slice(0, 64)
}

/**
 * Parse the leading `--- … ---` frontmatter, resolving the subset of YAML these
 * agent files use: `key: value`, folded block scalars (`key: >` / `key: |`), and
 * inline lists. CRLF-tolerant. Returns `{ data, body }`.
 */
function parseFrontmatter(text) {
  const norm = text.replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(norm)
  if (!m) return { data: {}, body: norm }
  const data = {}
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    const key = kv[1]
    let val = kv[2]
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      // Folded/literal block scalar: gather the deeper-indented lines.
      const block = []
      while (i + 1 < lines.length && (lines[i + 1] === '' || /^\s+/.test(lines[i + 1]))) {
        block.push(lines[++i].replace(/^\s+/, ''))
      }
      val = val.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim()
    } else {
      val = val.replace(/^["']|["']$/g, '')
    }
    data[key] = val
  }
  return { data, body: norm.slice(m[0].length) }
}

/** Split a CC `tools:` value ("Read, Bash" or "Read") into DSH tool names. */
function mapTools(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const dsh = []
  const unknown = []
  for (const t of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (TOOL_MAP[t]) dsh.push(TOOL_MAP[t])
    else unknown.push(t)
  }
  return { allow: dsh, unknown }
}

/** Load every `agents/*.md` under a plugin/agents dir. */
function loadAgents(agentsDir) {
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, body } = parseFrontmatter(readFileSync(join(agentsDir, f), 'utf8'))
      return {
        name: data.name ?? basename(f, '.md'),
        description: data.description ?? '',
        tools: mapTools(data.tools),
        model: data.model,
        persona: body.trim(),
      }
    })
}

// ---- minimal YAML emitter (flat scalar/array/dict) ----
function scalar(v) {
  if (typeof v !== 'string') return String(v)
  if (v === '' || /[:*#{}\[\]&!|>'"%@`]/.test(v) || /^\s|\s$/.test(v) || /^[-?]/.test(v)) return JSON.stringify(v)
  return v
}

/** Emit a persona as a YAML block scalar so multi-line prompts stay readable. */
function blockScalar(text, indent) {
  const pad = '  '.repeat(indent)
  return '|-\n' + text.split('\n').map((l) => (l ? pad + l : '')).join('\n')
}

function emitRow(agent, provider, namespace) {
  const tn = namespace ? toolName(`${namespace}-${agent.name}`) : toolName(agent.name)
  const lines = [
    `- id: agent-${tn}`,
    `  name: '@deepseek-ai/dsh-tool-subagent'`,
  ]
  if (agent.tools?.unknown?.length) {
    lines.push(`  # tools with no DSH counterpart dropped: ${agent.tools.unknown.join(', ')}`)
  }
  lines.push(`  config:`)
  lines.push(`    provider: ${provider}`)
  lines.push(`    toolName: ${tn}`)
  if (agent.tools && agent.tools.allow.length > 0) {
    lines.push(`    toolFilter:`)
    lines.push(`      allow:`)
    for (const t of agent.tools.allow) lines.push(`        - ${t}`)
  }
  lines.push(`    persona: ${blockScalar(agent.persona, 3)}`)
  return lines.join('\n')
}

// ---- main ----
import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

// Named exports for the test harness.
export { toolName, parseFrontmatter, mapTools, loadAgents, emitRow, TOOL_MAP }

if (isMain) {
  const arg = process.argv[2]
  const provider = (() => {
    const i = process.argv.indexOf('--provider')
    return i !== -1 ? process.argv[i + 1] : 'spawn'
  })()
  const namespace = (() => {
    const i = process.argv.indexOf('--namespace')
    return i !== -1 ? process.argv[i + 1] : undefined
  })()
  const wrapInsert = process.argv.includes('--insert')
  if (!arg) {
    console.error('usage: node cc-subagents.mjs <pluginRoot-or-agentsDir> [--provider spawn] [--namespace <plugin>] [--insert]')
    process.exit(2)
  }
  const agentsDir = existsSync(join(arg, 'agents')) && statSync(join(arg, 'agents')).isDirectory()
    ? join(arg, 'agents')
    : arg
  if (!existsSync(agentsDir)) {
    console.error(`no agents dir at ${agentsDir}`)
    process.exit(1)
  }

  const agents = loadAgents(agentsDir)
  const body = agents.map((a) => emitRow(a, provider, namespace)).join('\n\n')
  const out = wrapInsert
    ? `- insert:\n${body.split('\n').map((l) => (l ? '    ' + l : l)).join('\n')}`
    : body

  console.log(`# Generated from ${agentsDir}`)
  console.log(`# ${agents.length} tool-subagent row(s), provider=${provider}`)
  console.log(out)
}
