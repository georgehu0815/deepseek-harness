import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import Include, { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { load } from 'js-yaml'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { resolveChoreographySkillDir } from '../src/index.ts'

const choreographySkillDir = resolveChoreographySkillDir()

const root = new URL('../', import.meta.url)
const skillName = 'microduck-choreography'
const bundleName = '@deepseek-ai/dsh-robot-lab-bundle'

async function skillRow() {
  const patch = load(await readFile(new URL('cordis.patch.yml', root), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  const rows = applyEntryPatches([], patch, (warning) => { throw new Error(warning) })
  return rows.find(row => row.id === 'robot-lab-choreography-skills')!
}

describe('bundled MicroDuck choreography skill', () => {
  it('publishes one canonical instruction source and tracks the workspace alias target', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as { files: string[] }
    expect(manifest.files).toContain('skills')
    expect(choreographySkillDir).toBe(fileURLToPath(new URL('skills/', root)))
    const workspaceAlias = new URL('../../../.agents/skills/microduck-choreography', root)
    const target = (await lstat(workspaceAlias)).isSymbolicLink()
      ? await readlink(workspaceAlias)
      : await readFile(workspaceAlias, 'utf8')
    expect(target.trimEnd()).toBe('../../packages/bundle/robot-lab/skills/microduck-choreography')
  })

  it('discovers the canonical instructions through an isolated directory alias', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-choreography-alias-'))
    const alias = join(directory, skillName)
    const ctx = new Context()
    let linked = false
    try {
      await symlink(join(choreographySkillDir, skillName), alias, process.platform === 'win32' ? 'junction' : 'dir')
      linked = true
      expect(await realpath(join(alias, 'SKILL.md'))).toBe(await realpath(join(choreographySkillDir, skillName, 'SKILL.md')))
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { watch: false, includeDefaultRoots: false, customSkillDirs: [directory],
        dshHome: join(directory, 'empty-dsh'), agentsHome: join(directory, 'empty-agents') })
      const skill = await ctx.skills.get(skillName)
      expect(skill).toMatchObject({ name: skillName, source: 'custom', invocation: { modelInvocable: true, userInvocable: true } })
      expect(skill?.content).toContain('"kind": "microduck-sequence"')
      expect(skill?.content).toContain('## Optional health-dance reference')
    } finally {
      await ctx.fiber.dispose()
      if (linked) await unlink(alias)
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a stale carrier rather than silently mounting an empty provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-choreography-stale-'))
    try {
      const packagePath = join(directory, 'node_modules', bundleName)
      await mkdir(packagePath, { recursive: true })
      await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: bundleName, type: 'module', exports: './index.js' }))
      await writeFile(join(packagePath, 'index.js'), 'export {}\n')
      const row = await skillRow()
      expect(() => { interpolate({ baseUrl: pathToFileURL(directory).href + '/' }, row.config) }).toThrow('resolveChoreographySkillDir')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['installed', 'proxy'] as const)('loads from a %s package outside the workspace and disposes only its provider', async (mode) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-choreography-')))
    const ctx = new Context()
    try {
      const profile = join(directory, 'profile')
      const packagePath = join(profile, 'node_modules', bundleName)
      const installation = mode === 'proxy' ? join(directory, 'installation') : packagePath
      await mkdir(join(installation, 'lib'), { recursive: true })
      await cp(new URL('skills', root), join(installation, 'skills'), { recursive: true })
      // Compile into the fixture's lib-relative asset layout without consuming live build output.
      const compiled = ts.transpileModule(await readFile(new URL('src/index.ts', root), 'utf8'), {
        fileName: 'index.ts', reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      expect(compiled.diagnostics).toEqual([])
      await writeFile(join(installation, 'lib/index.js'), compiled.outputText)
      await writeFile(join(installation, 'package.json'), JSON.stringify({ name: bundleName, type: 'module', exports: { '.': './lib/index.js' } }))
      if (mode === 'proxy') {
        await mkdir(packagePath, { recursive: true })
        await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: bundleName, type: 'module', exports: { '.': './entry.js' } }))
        await writeFile(join(packagePath, 'entry.js'), `export * from ${JSON.stringify(pathToFileURL(join(installation, 'lib/index.js')).href)}\n`)
      }
      const baseUrl = pathToFileURL(profile).href + '/'
      expect(() => createRequire(baseUrl).resolve(`${bundleName}/package.json`)).toThrow()
      const row = await skillRow()
      const config = interpolate({ baseUrl }, row.config) as SkillFileSystem.Config
      expect(config).toEqual({ providerName: 'robot-lab-choreography', includeDefaultRoots: false,
        bundledSkillDir: fileURLToPath(pathToFileURL(join(installation, 'skills')).href + '/') })
      const modules = new Map<string, unknown>([
        ['@deepseek-ai/dsh-skill', SkillRegistry],
        ['@deepseek-ai/dsh-skill-filesystem', SkillFileSystem],
      ])
      const configPath = join(profile, 'cordis.yml')
      await writeFile(configPath, "- name: '@deepseek-ai/dsh-skill'\n- id: base-skills\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    includeDefaultRoots: false\n    watch: false\n")
      ctx.baseUrl = baseUrl
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      ctx.loader.internal = { version: 'v2', async import(name: string) {
        if (!modules.has(name)) throw new Error(`Unexpected module ${name}`)
        return modules.get(name)
      } } as unknown as NonNullable<typeof ctx.loader.internal>
      const includeId = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href,
        patches: [{ insert: [{ ...row, config: { ...row.config as Record<string, unknown>, watch: false } }] }] } })
      await ctx.loader.await()
      const cwd = join(directory, 'unrelated-workspace')
      const listed = await ctx.skills.list({ cwd })
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ name: skillName, provider: 'robot-lab-choreography', source: 'bundled' })
      const skill = await ctx.skills.get(skillName, { cwd })
      expect(skill?.path).toBe(join(installation, 'skills', skillName, 'SKILL.md'))
      const source = await readFile(join(choreographySkillDir, skillName, 'SKILL.md'), 'utf8')
      expect(source.endsWith(`${skill!.content}\n`)).toBe(true)
      expect(await ctx.skills.get('missing-choreography', { cwd })).toBeUndefined()
      await ctx.loader.resolve(includeId).subtree!.resolve('robot-lab-choreography-skills').update({ disabled: true })
      expect(await ctx.skills.list({ cwd })).toEqual([])
      expect(ctx.loader.resolve(includeId).subtree!.resolve('base-skills').fiber).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
