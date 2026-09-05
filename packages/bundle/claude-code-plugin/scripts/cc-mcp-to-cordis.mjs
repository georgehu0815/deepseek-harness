#!/usr/bin/env node
/**
 * Translate a Claude Code plugin's `.mcp.json` into DeepSeek Harness
 * `mcp-client` rows for a `cordis.yml` / bundle patch.
 *
 * Each `mcpServers` entry becomes one `@deepseek-ai/dsh-mcp-client` row:
 *   - `type: local|stdio`  -> transport: stdio  (command, args, env, cwd)
 *   - `type: http|sse`     -> transport: streamable-http (url, headers)
 *   - a `command` without a type is treated as stdio.
 *   - the server's `tools` array becomes `allowedTools`; `["*"]`, `[]`, or an
 *     omitted `tools` field registers every tool (allowedTools omitted).
 *   - `_`-prefixed keys are documentation comments and are skipped.
 *   - CC-only fields with no DSH counterpart (`type`, `authScope`) are dropped;
 *     a per-server comment records any dropped `authScope` so auth is not lost
 *     silently — supply it through `env`/`headers` for DSH.
 *
 * Usage:
 *   node cc-mcp-to-cordis.mjs <pluginRoot-or-.mcp.json> [--insert]
 *     default  -> prints a YAML list of rows (paste under an `insert:` / config)
 *     --insert -> wraps the rows in a `- insert:` bundle-patch block
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Resolve the .mcp.json path from a plugin root or a direct file path. */
function resolveMcpJson(input) {
  if (existsSync(input) && statSync(input).isDirectory()) return join(input, '.mcp.json')
  return input
}

/** `["*"]`, `[]`, non-array, or absent -> undefined (register all); else the names. */
function normalizeAllowlist(raw) {
  if (!Array.isArray(raw)) return undefined
  const list = raw.filter((t) => typeof t === 'string' && t.length > 0)
  if (list.length === 0 || list.includes('*')) return undefined
  return list
}

/** Map one raw entry to a resolved mcp-client config, or a reason it was skipped. */
function buildRow(name, raw, namespace) {
  const serverName = namespace ? `${namespace}-${name}` : name
  if (!SERVER_NAME.test(serverName)) {
    return { skip: `serverName "${serverName}" is not [A-Za-z0-9_-]{1,32}` }
  }
  const type = raw?.type
  const allowedTools = normalizeAllowlist(raw?.tools)
  const droppedAuthScope = typeof raw?.authScope === 'string' ? raw.authScope : undefined

  const stdio = () => ({
    row: {
      transport: 'stdio',
      serverName,
      command: raw.command,
      ...raw.args ? { args: raw.args } : {},
      ...raw.env ? { env: raw.env } : {},
      ...allowedTools ? { allowedTools } : {},
    },
    droppedAuthScope,
  })
  const http = () => ({
    row: {
      transport: 'streamable-http',
      serverName,
      url: raw.url,
      ...raw.headers ? { headers: raw.headers } : {},
      ...allowedTools ? { allowedTools } : {},
    },
    droppedAuthScope,
  })

  if (type === 'local' || type === 'stdio') return stdio()
  if (type === 'http' || type === 'sse') return http()
  if (raw?.command) return stdio()
  if (raw?.url) return http()
  return { skip: `entry "${name}" has neither command nor url and an unknown type ${JSON.stringify(type)}` }
}

/** Minimal YAML emitter for the flat scalar/array/dict shapes these rows use. */
function yamlValue(v, indent) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return '\n' + v.map((x) => `${pad}- ${scalar(x)}`).join('\n')
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    if (keys.length === 0) return '{}'
    return '\n' + keys.map((k) => `${pad}${k}: ${yamlValue(v[k], indent + 1)}`.replace(/: \n/, ':\n')).join('\n')
  }
  return scalar(v)
}

/** Quote a scalar when YAML would otherwise mis-parse it. */
function scalar(v) {
  if (typeof v !== 'string') return String(v)
  if (v === '' || /[:*#{}\[\]&!|>'"%@`]/.test(v) || /^\s|\s$/.test(v) || /^[-?]/.test(v)) {
    return JSON.stringify(v)
  }
  return v
}

function emitRow(row, comment) {
  const lines = [`- id: mcp-${row.serverName}`, `  name: '@deepseek-ai/dsh-mcp-client'`]
  if (comment) lines.push(`  # ${comment}`)
  lines.push(`  config:`)
  for (const [k, val] of Object.entries(row)) {
    lines.push(`    ${k}:${/^[\n]/.test(yamlValue(val, 3)) ? '' : ' '}${yamlValue(val, 3)}`)
  }
  return lines.join('\n')
}

// ---- main ----
const arg = process.argv[2]
const wrapInsert = process.argv.includes('--insert')
const namespace = (() => {
  const i = process.argv.indexOf('--namespace')
  return i !== -1 ? process.argv[i + 1] : undefined
})()
if (!arg) {
  console.error('usage: node cc-mcp-to-cordis.mjs <pluginRoot-or-.mcp.json> [--namespace <plugin>] [--insert]')
  process.exit(2)
}
const mcpPath = resolveMcpJson(arg)
if (!existsSync(mcpPath)) {
  console.error(`no .mcp.json at ${mcpPath}`)
  process.exit(1)
}

const doc = JSON.parse(readFileSync(mcpPath, 'utf8'))
const servers = doc?.mcpServers ?? {}
const rows = []
const skipped = []
for (const [key, raw] of Object.entries(servers)) {
  if (key.startsWith('_')) continue // documentation comment key
  const built = buildRow(key, raw, namespace)
  if (built.skip) { skipped.push(`${key}: ${built.skip}`); continue }
  const comment = built.droppedAuthScope
    ? `authScope ${JSON.stringify(built.droppedAuthScope)} dropped — supply DSH auth via env/headers`
    : undefined
  rows.push(emitRow(built.row, comment))
}

const body = rows.join('\n\n')
const out = wrapInsert
  ? `- insert:\n${body.split('\n').map((l) => (l ? '    ' + l : l)).join('\n')}`
  : body

console.log(`# Generated from ${mcpPath}`)
console.log(`# ${rows.length} mcp-client row(s)${skipped.length ? `, ${skipped.length} skipped` : ''}`)
console.log(out)
if (skipped.length) {
  console.error('\n# skipped entries:')
  for (const s of skipped) console.error(`#   ${s}`)
}
