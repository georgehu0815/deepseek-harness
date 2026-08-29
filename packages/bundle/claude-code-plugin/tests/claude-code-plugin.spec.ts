/**
 * Real-composition tests for the dsh-claude-code-plugin bundle.
 *
 * The bundle's substance is `cordis.patch.yml` plus the install generators. This
 * suite asserts:
 *   1. The `dsh.bundle.patch` manifest field names a parseable patch list whose
 *      config-only rows (cc-skills / cc-commands / cc-hooks) resolve the plugin
 *      root through CC_PLUGIN_ROOT `!!js` expressions.
 *   2. `scripts/install.mjs` generates a profile patch whose every mcp-client and
 *      tool-subagent row validates against its shipped Config.
 *   3. `scripts/cc-manifest.mjs` composes two colliding plugins into one
 *      collision-free, schema-valid profile with plugin-namespaced rows.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { Config as SubConfig } from '@deepseek-ai/dsh-tool-subagent'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPTS = resolve(ROOT, 'scripts')

/** Flatten a parsed patch list to its inserted rows. */
function insertRows(patchText: string): { id?: string; name?: string; disabled?: unknown; config?: Record<string, unknown> }[] {
  const parsed = yaml.load(patchText, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('patch must parse to a list')
  return parsed.flatMap(p => (p as { insert?: never[] }).insert ?? [])
}

/** Build a fixture Claude Code plugin under `dir`. */
function makePlugin(dir: string, opts: { mcp?: boolean; agents?: boolean; commands?: boolean } = {}): string {
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nB\n')
  if (opts.commands !== false) {
    mkdirSync(join(dir, 'commands'), { recursive: true })
    writeFileSync(join(dir, 'commands', 'go.md'), '---\ndescription: go\n---\nDo $ARGUMENTS.\n')
  }
  if (opts.agents !== false) {
    mkdirSync(join(dir, 'agents'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'aud.md'), '---\nname: aud\ndescription: >\n  auditor\ntools: Read\n---\nAudit.\n')
  }
  if (opts.mcp !== false) {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { kusto: { type: 'local', command: 'agency', args: ['mcp', 'kusto'], tools: ['kusto_query'] } },
    }))
  }
  return dir
}

describe('dsh-claude-code-plugin bundle patch', () => {
  it('declares a parseable patch list through dsh.bundle.patch', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const rows = insertRows(readFileSync(resolve(ROOT, manifest.dsh!.bundle!.patch!), 'utf8'))
    expect(rows.map(r => r.id).sort()).toEqual(['cc-commands', 'cc-hooks', 'cc-skills'])
  })

  it('keys the config-only rows on CC_PLUGIN_ROOT and gates hooks on a hooks file', () => {
    const rows = insertRows(readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8'))
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))

    expect(byId['cc-skills'].name).toBe('@deepseek-ai/dsh-skill-filesystem')
    expect(byId['cc-skills'].config!.customSkillDirs).toEqual({
      __jsExpr: "[process.getBuiltinModule('node:path').join(process.env.CC_PLUGIN_ROOT, 'skills')]",
    })
    expect(byId['cc-commands'].name).toBe('@deepseek-ai/dsh-cc-commands')
    expect(byId['cc-commands'].config!.pluginRoot).toEqual({ __jsExpr: 'process.env.CC_PLUGIN_ROOT' })
    expect(byId['cc-hooks'].name).toBe('@deepseek-ai/dsh-hooks-claude-code')
    expect(byId['cc-hooks'].disabled).toEqual({
      __jsExpr: "!process.getBuiltinModule('node:fs').existsSync(process.getBuiltinModule('node:path').join(process.env.CC_PLUGIN_ROOT, 'hooks', 'hooks.json'))",
    })
    expect(byId['cc-hooks'].config!.configPath).toEqual({
      __jsExpr: "process.getBuiltinModule('node:path').join(process.env.CC_PLUGIN_ROOT, 'hooks', 'hooks.json')",
    })
  })
})

describe('dsh-claude-code-plugin install (single plugin)', () => {
  let profileDir: string
  let plugin: string

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ccbundle-'))
    plugin = makePlugin(join(dir, 'plugin'))
    profileDir = join(dir, 'profile')
    execFileSync('node', [join(SCRIPTS, 'install.mjs'), plugin, profileDir], { encoding: 'utf8' })
  })

  it('generates a profile patch of schema-valid mcp-client and tool-subagent rows', () => {
    const rows = insertRows(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
    const mcp = rows.filter(r => r.name === '@deepseek-ai/dsh-mcp-client')
    const sub = rows.filter(r => r.name === '@deepseek-ai/dsh-tool-subagent')
    expect(mcp).toHaveLength(1)
    expect(sub).toHaveLength(1)
    const [mcpRow] = mcp
    const [subRow] = sub
    if (!mcpRow || !subRow) throw new Error('expected generated MCP and subagent rows')
    for (const r of mcp) expect(() => new McpConfig(r.config as ConstructorParameters<typeof McpConfig>[0])).not.toThrow()
    for (const r of sub) expect(() => new SubConfig(r.config as ConstructorParameters<typeof SubConfig>[0])).not.toThrow()
    expect(subRow.config!.toolFilter).toEqual({ allow: ['read'] })
    expect(mcpRow.config!.allowedTools).toEqual(['kusto_query'])
  })
})

describe('dsh-claude-code-plugin cc-manifest (multiple plugins)', () => {
  it('composes two colliding plugins into one collision-free, schema-valid profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccmani-'))
    const alpha = makePlugin(join(dir, 'alpha'))
    const beta = makePlugin(join(dir, 'beta'))
    const manifest = join(dir, 'manifest.json')
    writeFileSync(manifest, JSON.stringify({
      plugins: [{ root: alpha, name: 'alpha' }, { root: beta, name: 'beta' }],
      provider: 'spawn',
    }))
    const profileDir = join(dir, 'profile')
    execFileSync('node', [join(SCRIPTS, 'cc-manifest.mjs'), manifest, profileDir], { encoding: 'utf8' })

    const rows = insertRows(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
    const ids = rows.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length) // no id collisions

    const mcp = rows.filter(r => r.name === '@deepseek-ai/dsh-mcp-client')
    expect(mcp.map(r => r.config!.serverName).sort()).toEqual(['alpha-kusto', 'beta-kusto'])
    for (const r of mcp) expect(() => new McpConfig(r.config as ConstructorParameters<typeof McpConfig>[0])).not.toThrow()

    const sub = rows.filter(r => r.name === '@deepseek-ai/dsh-tool-subagent')
    expect(sub.map(r => r.config!.toolName).sort()).toEqual(['alpha-aud', 'beta-aud'])
    for (const r of sub) expect(() => new SubConfig(r.config as ConstructorParameters<typeof SubConfig>[0])).not.toThrow()

    const skills = rows.find(r => r.id === 'cc-skills')
    expect(skills!.config!.customSkillDirs).toEqual([join(alpha, 'skills'), join(beta, 'skills')])
    expect(rows.filter(r => r.name === '@deepseek-ai/dsh-cc-commands')).toHaveLength(2)
  })
})
