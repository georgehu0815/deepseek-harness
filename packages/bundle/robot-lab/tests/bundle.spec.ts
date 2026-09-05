import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

const root = new URL('../', import.meta.url)
const patches = () => load(readFileSync(new URL('cordis.patch.yml', root), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  dsh: { bundle: { patch: string } }
  dependencies: Record<string, string>
}

describe('opt-in MicroDuck Studio bundle', () => {
  it('composes declared service, provider, tool and client rows without replacing existing plugins', () => {
    const warnings: string[] = []
    const existing = [{ id: 'existing', name: 'existing-plugin', config: { keep: true } }]
    const rows = applyEntryPatches(existing, patches(), warning => warnings.push(warning))
    expect(warnings).toEqual([])
    expect(rows[0]).toEqual(existing[0])
    expect(rows.slice(1).map(row => row.id)).toEqual(['robot-lab', 'robot-lab-microduck', 'tool-robot-lab', 'ui-robot-lab'])
    for (const row of rows.slice(1)) expect(manifest.dependencies[row.name!]).toBe('workspace:^')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('requires explicitly supplied installation paths before enabling Python', () => {
    const rows = applyEntryPatches([], patches(), (warning) => { throw new Error(warning) })
    const provider = rows.find(row => row.id === 'robot-lab-microduck')!
    expect(provider.disabled).toEqual({ __jsExpr: '!process.env.DSH_MICRODUCK_SOURCE_ROOT || !process.env.DSH_MICRODUCK_PYTHON' })
    expect(provider.config).toEqual({
      sourceRoot: { __jsExpr: 'process.env.DSH_MICRODUCK_SOURCE_ROOT' },
      pythonBin: { __jsExpr: 'process.env.DSH_MICRODUCK_PYTHON' },
      mlxPythonBin: { __jsExpr: 'process.env.DSH_MICRODUCK_MLX_PYTHON || undefined' },
    })
  })
})
