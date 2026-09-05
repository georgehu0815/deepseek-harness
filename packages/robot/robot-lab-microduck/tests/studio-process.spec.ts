/** Opt-in real Python-to-TypeScript JSON checks; no server, learner, or hardware activation. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { Config, parseReply } from '../src/index.ts'

const source = process.env.DSH_MICRODUCK_SOURCE_ROOT
const python = process.env.DSH_MICRODUCK_PYTHON

it.skipIf(!source || !python)('parses real catalog, frozen project, reference frames and CPU admission', { timeout: 60_000 }, () => {
  if (source === undefined || python === undefined) throw new Error('Real studio test requires installed source and Python paths')
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-process-'))
  const config = Config({ sourceRoot: source, pythonBin: python, maxSimulationSteps: 64 })
  const bridge = fileURLToPath(new URL('../python/bridge.py', import.meta.url))
  const request = (value: object) => {
    const result = spawnSync(python, ['-B', bridge, '--source', source, '--root', root], {
      encoding: 'utf8', input: JSON.stringify({ request: value, limits: config }), timeout: 30_000,
      maxBuffer: config.maxOutputBytes,
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, PYTHONDONTWRITEBYTECODE: '1',
        OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' },
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Python studio request failed: ${result.stderr}`)
    return parseReply(result.stdout, config)
  }
  try {
    const catalog = request({ operation: 'studio' })
    if (catalog.operation !== 'studio') throw new Error('Expected studio catalog')
    expect(catalog.catalog.profiles).toHaveLength(1)
    expect(catalog.catalog.templates).toHaveLength(9)
    expect(catalog.catalog.templates.filter(template => template.category === 'action').map(({ id, label }) => ({ id, label })))
      .toEqual([{ id: 'stand', label: 'Stand Steady' }, { id: 'hello', label: 'Say Hello' }, { id: 'look-around', label: 'Look Around' }])
    const behaviors = request({ operation: 'behaviors' })
    if (behaviors.operation !== 'behaviors') throw new Error('Expected registered reward behaviors')
    const behaviorIds = new Set(behaviors.behaviors.map(behavior => behavior.id))
    expect(catalog.catalog.templates.every(template => behaviorIds.has(template.behaviorId))).toBe(true)
    expect(catalog.catalog.templates.find(template => template.id === 'stand')?.behaviorId).toBe('stand')
    for (const template of catalog.catalog.templates) {
      const behavior = behaviors.behaviors.find(behavior => behavior.id === template.behaviorId)
      if (behavior === undefined) throw new Error('Template requires an installed reward behavior')
      const rewardKeys = new Set(behavior.terms.map(term => term.key))
      expect(Object.keys(template.trainingWeights).every(key => rewardKeys.has(key))).toBe(true)
      expect(template.trainingWeights).toEqual(template.behaviorId === 'stand' ? {} : { travel: 0 })
    }
    const profile = catalog.catalog.profiles[0]
    const template = catalog.catalog.templates.find(template => template.id === 'stand')
    if (profile === undefined || template === undefined) throw new Error('Expected installed MicroDuck and Stand')
    expect(profile.rootBody.name).toBe('trunk_base')
    const saved = request({ operation: 'save_project', recipe: {
      projectId: null, name: ' 我的鸭鸭 / ディスコ 🦆💃 ', profileId: profile.id, templateId: template.id, templateVersion: 1,
      parameters: template.defaultParameters, music: { version: 1, style: 'disco', bpm: 96, beats: 32, seed: 9 },
      blocks: [{ templateId: template.id, templateVersion: 1, beats: 16, moveSize: 1 },
        { templateId: 'head-bob', templateVersion: 1, beats: 16, moveSize: 0.8 }],
    } })
    if (saved.operation !== 'save_project') throw new Error('Expected saved project')
    expect(saved.project.clip.duration).toBe(20)
    expect(saved.project.recipe.name).toBe(' 我的鸭鸭 / ディスコ 🦆💃 ')
    expect(saved.project.clip.name).toBe(saved.project.recipe.name)
    expect(saved.project.training).toEqual({ behaviorId: 'imitate', weights: { travel: 0 } })
    expect(saved.project.blocks).toHaveLength(2)
    expect(saved.project.template.behaviorId).toBe('stand')
    expect(saved.project.blocks.map(block => block.moveSize)).toEqual([0.5, 0.4])
    const blocks = saved.project.recipe.blocks
    if (blocks === undefined || blocks[1] === undefined) throw new Error('Expected authored sequence blocks')
    const edited = request({ operation: 'save_project', recipe: { ...saved.project.recipe, projectId: saved.project.projectId,
      parameters: { ...saved.project.recipe.parameters, beats: 48 }, music: { ...saved.project.recipe.music, beats: 48 },
      blocks: [...blocks, blocks[1]],
    } })
    if (edited.operation !== 'save_project') throw new Error('Expected duplicated sequence revision')
    expect(edited.project.sha256).not.toBe(saved.project.sha256)
    expect(edited.project.blocks).toHaveLength(3)
    const retrieved = request({ operation: 'project', projectRevisionId: saved.project.id })
    expect(retrieved).toEqual({ operation: 'project', project: saved.project })
    const preview = request({ operation: 'reference_preview', projectRevisionId: saved.project.id })
    if (preview.operation !== 'reference_preview') throw new Error('Expected reference preview')
    expect(preview.preview.mode).toBe('kinematic-reference')
    expect(preview.preview.frames.length).toBeGreaterThan(1)
    expect(preview.preview.frames.every(frame => frame.telemetry.actuatorTorque === null && frame.telemetry.controllerTarget === null
      && frame.telemetry.jointVelocity === null && frame.telemetry.rootLinearVelocityWorld === null
      && frame.telemetry.rootSpeed === null)).toBe(true)
    const admitted = request({ operation: 'prepare_train', runId: 'run-00000000-0000-0000-0000-000000000000', spec: {
      backend: 'cpu', name: `project-${saved.project.id}`, behaviorId: saved.project.training.behaviorId, steps: 32, envs: 1, seed: 9,
      actuator: 'bam', weights: saved.project.training.weights, clip: null, projectRevisionId: saved.project.id,
    } })
    if (admitted.operation !== 'train') throw new Error('Expected frozen admission')
    expect(admitted.run.spec.clip).toEqual(saved.project.clip)
    expect(admitted.run.spec.projectSnapshot).toEqual(saved.project)
    expect(admitted.run.provenance.trainer.helperSha256).toEqual({})
    expect(admitted.run.state).toBe('starting')
    expect(admitted.run.policyId).toBeNull()
    const simulation = request({ operation: 'simulate', policyId: 'shipped:alpha_stand', steps: 8, seed: 9, command: [0, 0, 0] })
    if (simulation.operation !== 'simulate') throw new Error('Expected recorded policy simulation')
    expect(simulation.simulation.frames.length).toBeGreaterThan(0)
    expect(simulation.simulation.frames.every(frame => frame.telemetry.jointPosition.length === 14
      && frame.telemetry.jointVelocity?.length === 14 && frame.telemetry.rootLinearVelocityWorld?.length === 3
      && typeof frame.telemetry.rootSpeed === 'number'
      && frame.telemetry.controllerTarget?.length === 14 && frame.telemetry.actuatorTorque?.length === 14)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
