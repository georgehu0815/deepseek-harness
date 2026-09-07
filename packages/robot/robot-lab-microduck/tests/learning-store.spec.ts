import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { RobotEvaluationId, RobotReflectionId, RobotReflectionRequest, RobotRun, RobotTrial, RobotTrialId } from '@deepseek-ai/dsh-robot-lab'
import { Config, MicroduckProvider } from '../src/index.ts'
import { LearningStore, learningHash, type LearningLimits } from '../src/learning-store.ts'
import { learningDanceCriteria, learningDancePlan, learningEvaluation, learningProject, learningRecipe, learningRun, memoryLearningFs, putLearningEvaluation } from './learning-fixtures.ts'

function setup(overrides: Partial<LearningLimits> = {}, mode: SandboxExecutionPolicy['mode'] = 'workspace-write') {
  const memory = memoryLearningFs()
  const limits = Object.assign(Config({ sourceRoot: '/configured/lab', pythonBin: '/configured/python' }), overrides)
  const controller = new AbortController()
  const policy = { mode, workspaceRoot: '/owned' }
  const store = new LearningStore(memory.fs, memory.root, policy, limits, controller.signal)
  const project = learningProject()
  memory.put(['projects', `${project.id}.json`], project)
  return { memory, limits, controller, policy, store, project }
}
async function evidence() {
  const context = setup()
  const trial = await context.store.saveTrial(learningRecipe(context.project), context.project)
  const run = learningRun(trial, context.project)
  context.memory.put(['runs', run.id, 'manifest.json'], run)
  const binding = await context.store.bind(trial, run)
  const evaluation = learningEvaluation(trial, run)
  putLearningEvaluation(context.memory, evaluation)
  const request: RobotReflectionRequest = { trialId: trial.id, evaluationId: evaluation.id,
    observation: 'Both seeded rollouts stayed upright.', interpretation: 'No evidence of hardware readiness.',
    nextChange: 'Increase the motion size slightly.' }
  return { ...context, trial, run, binding, evaluation, request }
}
function change(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split('.')
  let object = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) object = object[key] as Record<string, unknown>
  object[keys.at(-1)!] = replacement
}
function tamper(memory: ReturnType<typeof memoryLearningFs>, parts: string[], path: string, value: unknown, rehash = true): void {
  const record = memory.json(...parts) as Record<string, unknown>
  change(record, path, value)
  if (rehash) {
    const { sha256: _sha256, ...content } = record
    record.sha256 = learningHash(content)
  }
  memory.put(parts, record)
}
afterEach(() => { vi.useRealTimers() })

describe('immutable learning trials', () => {
  it('saves a new hash-bound trial with CPU resolved, four prospective brief strings and no training admission', async () => {
    const { store, memory, project, controller } = setup()
    const recipe = learningRecipe(project)
    const before = memory.files.get(memory.path('projects', `${project.id}.json`))!.slice()
    const trial = await store.saveTrial(recipe, project)
    expect(trial).toMatchObject({ version: 1, projectRevisionId: project.id, projectSha256: project.sha256,
      recipe: { spec: { backend: 'cpu', clip: null }, brief: recipe.brief } })
    expect(trial.id).toMatch(/^trial-[a-f0-9-]{36}$/)
    expect(Object.keys(trial.recipe.brief).sort()).toEqual(['evidence', 'goal', 'plannedChange', 'prediction'])
    expect(Object.values(trial.recipe.brief).every(value => typeof value === 'string')).toBe(true)
    expect(recipe.spec.backend).toBeUndefined()
    const { sha256, ...content } = trial
    expect(sha256).toBe(learningHash(content))
    expect(await store.trial(trial.id)).toEqual(trial)
    expect(await store.binding(trial)).toBeNull()
    expect(await store.trialIds()).toEqual([trial.id])
    expect([...memory.files.keys()].some(path => path.includes('/runs/'))).toBe(false)
    expect(memory.files.get(memory.path('projects', `${project.id}.json`))).toEqual(before)
    expect(memory.methods.writeText).toHaveBeenCalledWith(expect.anything(), JSON.stringify(trial) + '\n',
      { kind: 'createIfAbsent' }, controller.signal, { mode: 'workspace-write', workspaceRoot: '/owned' })
    recipe.brief.goal = 'Changed caller request'
    expect((await store.trial(trial.id)).recipe.brief.goal).toBe(content.recipe.brief.goal)
  })

  it.each(['hash', 'content'])('refuses a project %s change after its Python-validated snapshot was captured', async (kind) => {
    const { store, memory, project } = setup()
    const changed = structuredClone(project)
    if (kind === 'hash') changed.sha256 = 'd'.repeat(64)
    else { changed.recipe.name = 'Changed reference'; changed.clip.name = 'Changed reference' }
    memory.put(['projects', `${project.id}.json`], changed)
    await expect(store.saveTrial(learningRecipe(project), project)).rejects.toThrow('changed after Python validation')
    expect(memory.methods.writeText).not.toHaveBeenCalled()
    expect(await store.trialIds()).toEqual([])
  })

  it('keeps independently saved recipes immutable and preserves an explicit MLX backend', async () => {
    const { store, project } = setup()
    const recipe = learningRecipe(project)
    recipe.spec.backend = 'mlx'
    const first = await store.saveTrial(recipe, project)
    const second = await store.saveTrial(recipe, project)
    expect(first.id).not.toBe(second.id)
    expect(first.sha256).not.toBe(second.sha256)
    expect(second.recipe.spec.backend).toBe('mlx')
    expect(await store.trialIds()).toEqual([first.id, second.id].sort())
  })

  it('hashes host JSON canonically without conflating array order or accepting nonfinite JSON', () => {
    expect(learningHash({ z: { b: 2, a: 1 }, a: [1, null, true, '🦆'] })).toBe(learningHash({ a: [1, null, true, '🦆'], z: { a: 1, b: 2 } }))
    expect(learningHash([1, 2])).not.toBe(learningHash([2, 1]))
    for (const value of [undefined, NaN, Infinity, { value: undefined }]) expect(() => learningHash(value)).toThrow('finite JSON')
  })

  it.each(['goal', 'prediction', 'plannedChange', 'evidence'])('validates required brief.%s text, rejecting retrospective object evidence', (key) => {
    const { store, project } = setup()
    for (const value of [undefined, '', '   ', { evaluationId: 'not-a-plan' }, 42, 'control\ntext', '\ud800']) {
      const recipe = learningRecipe(project)
      change(recipe, `brief.${key}`, value)
      expect(() => { store.validateRecipe(recipe) }).toThrow()
    }
  })

  it.each([
    ['maxTrainingSteps', 'spec.steps', 256, 255], ['maxEnvs', 'spec.envs', 2, 1], ['maxRewardWeight', 'spec.weights.pose', 2, 1],
    ['maxEvaluationEpisodes', 'evaluation.episodes', 2, 1], ['maxSimulationSteps', 'evaluation.stepsPerEpisode', 100, 99],
  ] as const)('enforces configured %s on creation and historical reads', async (key, path, requested, bound) => {
    const { store, project, limits } = setup()
    const recipe = learningRecipe(project)
    change(recipe, path, requested)
    const trial = await store.saveTrial(recipe, project)
    limits[key] = bound
    expect(() => { store.validateRecipe(recipe) }).toThrow('configured limits')
    await expect(store.trial(trial.id)).rejects.toThrow('configured limits')
  })

  it('counts Unicode characters for each brief field and enforces the inclusive limit', async () => {
    const { store, project, limits } = setup({ maxLearningTextLength: 2 })
    const recipe = learningRecipe(project)
    recipe.brief = { goal: '🦆🦆', prediction: '二字', plannedChange: 'ok', evidence: '📐📈' }
    const trial = await store.saveTrial(recipe, project)
    expect(await store.trial(trial.id)).toEqual(trial)
    recipe.brief.evidence += 'x'
    await expect(store.saveTrial(recipe, project)).rejects.toThrow('maxLearningTextLength')
    limits.maxLearningTextLength = 1
    await expect(store.trial(trial.id)).rejects.toThrow('maxLearningTextLength')
  })

  it.each([
    ['version', 2, 'Unsupported'], ['id', 'trial-00000000-0000-4000-8000-000000000009', 'filename'],
    ['projectSha256', 'b'.repeat(64), 'project identity'], ['projectRevisionId', 'revision-00000000-0000-4000-8000-000000000009', 'project identity'],
    ['recipe.spec.backend', undefined, 'resolved backend'], ['createdAt', '2026-01-01T00:00:00', 'timestamp'],
    ['recipe.extra', true, 'unsupported'], ['extra', true, 'unsupported'],
  ])('rejects a rehashed trial with invalid %s', async (path, value, message) => {
    const { store, memory, project } = setup()
    const trial = await store.saveTrial(learningRecipe(project), project)
    const parts = ['learning', 'trials', `${trial.id}.json`]
    if (value === undefined) {
      const record = memory.json(...parts) as RobotTrial
      delete record.recipe.spec.backend
      const { sha256: _sha256, ...content } = record
      memory.put(parts, { ...content, sha256: learningHash(content) })
    } else tamper(memory, parts, path, value)
    await expect(store.trial(trial.id)).rejects.toThrow(message)
  })

  it('rejects content tampering without treating Python project digests as host JSON hashes', async () => {
    const { store, memory, project } = setup()
    const trial = await store.saveTrial(learningRecipe(project), project)
    expect(learningHash(project)).not.toBe(project.sha256)
    tamper(memory, ['learning', 'trials', `${trial.id}.json`], 'recipe.brief.goal', 'Tampered goal', false)
    await expect(store.trial(trial.id)).rejects.toThrow('content hash mismatch')
  })

  it('requires the selected project and its filename identity, schema and digest reference', async () => {
    const { store, memory, project } = setup()
    const trial = await store.saveTrial(learningRecipe(project), project)
    const path = memory.path('projects', `${project.id}.json`)
    memory.files.delete(path)
    await expect(store.saveTrial(learningRecipe(project), project)).rejects.toThrow('ENOENT')
    await expect(store.trial(trial.id)).rejects.toThrow('ENOENT')
    memory.put(['projects', `${project.id}.json`], { ...project, id: 'revision-00000000-0000-4000-8000-000000000009' })
    await expect(store.project(project.id)).rejects.toThrow('filename')
    memory.put(['projects', `${project.id}.json`], { ...project, version: 1 })
    await expect(store.project(project.id)).rejects.toThrow('version')
    memory.put(['projects', `${project.id}.json`], { ...project, sha256: 'f'.repeat(64) })
    await expect(store.trial(trial.id)).rejects.toThrow('content differs')
  })

  it('checks trial history caps before publishing and rejects oversized historical collections', async () => {
    const { store, project, limits } = setup({ maxTrials: 1 })
    await store.saveTrial(learningRecipe(project), project)
    await expect(store.saveTrial(learningRecipe(project), project)).rejects.toThrow('Maximum saved trials')
    limits.maxTrials = 2
    await store.saveTrial(learningRecipe(project), project)
    limits.maxTrials = 1
    await expect(store.trialIds()).rejects.toThrow('record count')
  })
})

describe('actual run bindings and reflection evidence', () => {
  it.each([1, 2] as const)('binds an unstarted v%s assessment without upgrade and refuses a later version substitution', async (version) => {
    const { store, project, memory } = setup({ maxSimulationSteps: 2000 })
    const recipe = learningRecipe(project)
    recipe.evaluation = { ...recipe.evaluation, stepsPerEpisode: 2000, dance: { ...learningDanceCriteria(), version } }
    const trial = await store.saveTrial(recipe, project)
    const original = memory.files.get(memory.path('learning', 'trials', `${trial.id}.json`))!.slice()
    const saved = await store.trial(trial.id)
    expect(saved.recipe.evaluation.dance!.version).toBe(version)
    const run = learningRun(saved, project)
    run.dancePlan = learningDancePlan(saved, run)
    memory.put(['runs', run.id, 'manifest.json'], run)
    const binding = await store.bind(saved, await store.run(run.id))
    expect(await store.binding(saved)).toEqual(binding)

    const otherVersion = version === 1 ? 2 : 1
    run.dancePlan.version = run.dancePlan.evaluation.dance.version = otherVersion
    memory.put(['runs', run.id, 'manifest.json'], run)
    expect((await store.run(run.id)).dancePlan!.version).toBe(otherVersion)
    await expect(store.binding(saved)).rejects.toThrow('Run dance plan differs')
    expect(memory.files.get(memory.path('learning', 'trials', `${trial.id}.json`))).toEqual(original)
  })
  it('binds one actual run and records immutable policy, criteria and report references', async () => {
    const { store, trial, run, binding, request, evaluation } = await evidence()
    expect(await store.binding(trial)).toEqual(binding)
    expect(await store.completedRun(trial)).toEqual(run)
    expect(await store.matchEvaluation(trial, evaluation)).toEqual(run)
    const reflection = await store.saveReflection(request)
    expect(reflection).toMatchObject({ ...request, trialSha256: trial.sha256, runId: run.id,
      policyHash: run.policySha256, reportSha256: learningHash(evaluation), version: 1 })
    expect(await store.reflection(reflection.id)).toEqual(reflection)
    expect(await store.reflections()).toEqual([reflection])
    expect(await store.evaluations()).toEqual({ evaluations: [evaluation], incompleteCount: 0 })
  })

  it.each(['binding', 'reflection'] as const)('validates %s version, hash and exact persisted fields', async (kind) => {
    const { store, memory, trial, request } = await evidence()
    const reflection = await store.saveReflection(request)
    const parts = kind === 'binding' ? ['learning', 'bindings', `${trial.id}.json`]
      : ['learning', 'reflections', `${reflection.id}.json`]
    const original = memory.json(...parts)
    const read = () => kind === 'binding' ? store.binding(trial) : store.reflection(reflection.id)
    tamper(memory, parts, 'version', 2)
    await expect(read()).rejects.toThrow('Unsupported')
    memory.put(parts, original)
    tamper(memory, parts, 'createdAt', '2026-09-04T00:00:00Z', false)
    await expect(read()).rejects.toThrow('content hash mismatch')
    memory.put(parts, original)
    tamper(memory, parts, 'sha256', 'bad', false)
    await expect(read()).rejects.toThrow('SHA256')
    memory.put(parts, original)
    tamper(memory, parts, 'extra', 'unrecognized')
    await expect(read()).rejects.toThrow('unsupported fields')
  })

  it('never overwrites the first trial run binding', async () => {
    const { store, memory, trial, run, binding } = await evidence()
    const original = memory.files.get(memory.path('learning', 'bindings', `${trial.id}.json`))!.slice()
    await expect(store.bind(trial, run)).rejects.toThrow('FS_NOT_OBSERVED')
    expect(await store.binding(trial)).toEqual(binding)
    expect(memory.files.get(memory.path('learning', 'bindings', `${trial.id}.json`))).toEqual(original)
  })

  it.each(['name', 'seed', 'steps', 'envs', 'weights', 'backend', 'clip', 'projectSnapshot'])('refuses a binding with altered prepared-run %s', async (key) => {
    const { store, trial, run } = await evidence()
    const replacements: Record<string, unknown> = { name: 'other', seed: 43, steps: 257, envs: 2,
      weights: { pose: 2 }, backend: 'mlx', clip: null, projectSnapshot: undefined }
    change(run, `spec.${key}`, replacements[key])
    expect(() => { store.matchRun(trial, run) }).toThrow('frozen trial')
    await expect(store.bind(trial, run)).rejects.toThrow('frozen trial')
  })

  it.each([
    ['trialId', 'trial-00000000-0000-4000-8000-000000000009'], ['trialSha256', '0'.repeat(64)], ['recipeHash', '0'.repeat(64)],
  ])('rechecks binding %s against the trial and actual run', async (path, value) => {
    const { store, memory, trial } = await evidence()
    tamper(memory, ['learning', 'bindings', `${trial.id}.json`], path, value)
    await expect(store.binding(trial)).rejects.toThrow('differs')
  })

  it.each(['starting', 'running', 'failed', 'stopped', 'interrupted'] as const)('does not use %s runs as completed reflection evidence', async (state) => {
    const { store, memory, run, request } = await evidence()
    memory.put(['runs', run.id, 'manifest.json'], { ...run, state })
    await expect(store.saveReflection(request)).rejects.toThrow(/completed.*policy/)
  })

  it('revalidates the actual run manifest after a binding has been published', async () => {
    const { store, memory, trial, run } = await evidence()
    const parts = ['runs', run.id, 'manifest.json']
    memory.put(parts, { ...run, recipeHash: '0'.repeat(64) })
    await expect(store.binding(trial)).rejects.toThrow('recipe hash differs')
    memory.put(parts, { ...run, spec: { ...run.spec, seed: run.spec.seed + 1 } })
    await expect(store.binding(trial)).rejects.toThrow('frozen trial')
    memory.put(parts, { ...run, formatVersion: 2 })
    await expect(store.run(run.id)).rejects.toThrow('Unsupported')
    memory.put(parts, { ...run, id: 'run-00000000-0000-4000-8000-000000000009' })
    await expect(store.run(run.id)).rejects.toThrow('filename')
  })

  it('requires a run binding and actual completed-run policy identity/hash', async () => {
    const { store, memory, trial, run } = await evidence()
    memory.files.delete(memory.path('learning', 'bindings', `${trial.id}.json`))
    await expect(store.completedRun(trial)).rejects.toThrow('no admitted run')
    await store.bind(trial, run)
    memory.put(['runs', run.id, 'manifest.json'], { ...run, policyId: 'shipped:alpha_stand' })
    await expect(store.completedRun(trial)).rejects.toThrow('completed policy')
    memory.put(['runs', run.id, 'manifest.json'], { ...run, policySha256: null })
    await expect(store.completedRun(trial)).rejects.toThrow('policySha256')
  })

  it('reads the host terminal overlay without mutating the frozen Python manifest', async () => {
    const { store, memory, run, trial } = await evidence()
    const original = memory.files.get(memory.path('runs', run.id, 'manifest.json'))!.slice()
    memory.put(['runs', run.id, 'state.json'], { state: 'interrupted', error: 'Host stopped', finishedAt: run.finishedAt })
    expect(await store.run(run.id)).toMatchObject({ state: 'interrupted', error: 'Host stopped' })
    await expect(store.completedRun(trial)).rejects.toThrow('completed policy')
    expect(memory.files.get(memory.path('runs', run.id, 'manifest.json'))).toEqual(original)
    memory.put(['runs', run.id, 'state.json'], { state: 'completed', error: null, finishedAt: run.finishedAt })
    await expect(store.run(run.id)).rejects.toThrow('terminal run state')
  })

  it.each([
    ['policyHash', '0'.repeat(64)], ['observationProfile', 'microduck-standard-61'], ['physics.bam.sha256', '0'.repeat(64)],
    ['physics.bam.parameters.kt', 0.5], ['spec.maxTerminations', 1], ['spec.minMeanUprightFraction', 0.7],
  ])('rejects a valid evaluation pair that differs from frozen trial evidence at %s', async (path, value) => {
    const { store, memory, evaluation, request } = await evidence()
    change(evaluation, path, value)
    putLearningEvaluation(memory, evaluation)
    await expect(store.saveReflection(request)).rejects.toThrow('Evaluation differs')
  })

  it('rejects changed evaluation seeds and horizons even when the complete report is internally consistent', async () => {
    const { store, memory, evaluation, request } = await evidence()
    evaluation.spec.seed += 1
    evaluation.spec.stepsPerEpisode -= 1
    for (const episode of evaluation.episodes) { episode.seed += 1; episode.steps -= 1 }
    putLearningEvaluation(memory, evaluation)
    await expect(store.saveReflection(request)).rejects.toThrow('Evaluation differs')
  })

  it('rejects a different actual policy and evidence recorded before the trial', async () => {
    const { store, memory, trial, run, evaluation, request } = await evidence()
    const original = structuredClone(evaluation)
    const otherRunId = 'run-00000000-0000-4000-8000-000000000009' as RobotRun['id']
    evaluation.policyId = evaluation.spec.policyId = `run:${otherRunId}` as typeof evaluation.policyId
    memory.put(['runs', otherRunId, 'manifest.json'], { ...run, id: otherRunId, policyId: evaluation.policyId })
    putLearningEvaluation(memory, evaluation)
    await expect(store.saveReflection(request)).rejects.toThrow('Evaluation differs')
    original.createdAt = original.evaluatedAt = new Date(Date.parse(trial.createdAt) - 1).toISOString()
    putLearningEvaluation(memory, original)
    await expect(store.saveReflection(request)).rejects.toThrow('Evaluation differs')
  })

  it.each([
    ['trialSha256', '0'.repeat(64)], ['runId', 'run-00000000-0000-4000-8000-000000000009'],
    ['policyHash', '0'.repeat(64)], ['reportSha256', '0'.repeat(64)], ['createdAt', '2025-01-01T00:00:00Z'],
  ])('rechecks saved reflection %s rather than trusting its valid content hash', async (path, value) => {
    const { store, memory, request } = await evidence()
    const reflection = await store.saveReflection(request)
    tamper(memory, ['learning', 'reflections', `${reflection.id}.json`], path, value)
    await expect(store.reflection(reflection.id)).rejects.toThrow('frozen references')
  })

  it('detects later report tampering even when it still meets the frozen criteria', async () => {
    const { store, memory, request, evaluation } = await evidence()
    const reflection = await store.saveReflection(request)
    evaluation.episodes[0]!.reward += 1
    putLearningEvaluation(memory, evaluation)
    await expect(store.reflection(reflection.id)).rejects.toThrow('frozen references')
  })

  it('enforces reflection text and collection bounds on save and read', async () => {
    const { store, limits, request } = await evidence()
    limits.maxReflections = 1
    const reflection = await store.saveReflection(request)
    await expect(store.saveReflection(request)).rejects.toThrow('Maximum saved reflections')
    limits.maxReflections = 2
    await store.saveReflection(request)
    limits.maxReflections = 1
    await expect(store.reflections()).rejects.toThrow('record count')
    limits.maxLearningTextLength = 1
    await expect(store.reflection(reflection.id)).rejects.toThrow('maxLearningTextLength')
    await expect(store.saveReflection(request)).rejects.toThrow('maxLearningTextLength')
  })

  it('rejects future-dated evaluation evidence before publishing a reflection', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    const { store, memory, request, evaluation } = await evidence()
    evaluation.evaluatedAt = '2026-09-04T12:00:01Z'
    putLearningEvaluation(memory, evaluation)
    memory.methods.writeText.mockClear()
    await expect(store.saveReflection(request)).rejects.toThrow('future-dated')
    expect(memory.methods.writeText).not.toHaveBeenCalled()
  })

  it('refuses a child trial whose parent reflection is later than the host clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    const { store, memory, project, request } = await evidence()
    const parent = await store.saveReflection(request)
    const recipe = learningRecipe(project)
    recipe.parentReflectionId = parent.id
    vi.setSystemTime(new Date('2026-09-04T11:59:59Z'))
    memory.methods.writeText.mockClear()
    await expect(store.saveTrial(recipe, project)).rejects.toThrow()
    expect(memory.methods.writeText).not.toHaveBeenCalled()
  })

  it('links a child trial only to an existing valid earlier reflection', async () => {
    const { store, project, request } = await evidence()
    const parent = await store.saveReflection(request)
    const recipe = learningRecipe(project)
    recipe.parentReflectionId = parent.id
    const child = await store.saveTrial(recipe, project)
    expect((await store.trial(child.id)).recipe.parentReflectionId).toBe(parent.id)
    recipe.parentReflectionId = 'reflection-00000000-0000-4000-8000-000000000009' as RobotReflectionId
    await expect(store.saveTrial(recipe, project)).rejects.toThrow('ENOENT')
  })

  it('revalidates the actual evidence behind a saved child trial parent', async () => {
    const { store, memory, project, request } = await evidence()
    const parent = await store.saveReflection(request)
    const child = await store.saveTrial({ ...learningRecipe(project), parentReflectionId: parent.id }, project)
    tamper(memory, ['learning', 'reflections', `${parent.id}.json`], 'reportSha256', '0'.repeat(64))
    await expect(store.trial(child.id)).rejects.toThrow('frozen references')
  })

  it('rejects an indirect parent cycle before following unbounded references', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    const { store, memory, trial, project, request } = await evidence()
    const parent = await store.saveReflection(request)
    const child = await store.saveTrial({ ...learningRecipe(project), parentReflectionId: parent.id }, project)
    const id = 'reflection-00000000-0000-4000-8000-000000000009' as RobotReflectionId
    const { sha256: _sha256, ...fields } = parent
    const content = { ...fields, id, trialId: child.id, trialSha256: child.sha256 }
    memory.put(['learning', 'reflections', `${id}.json`], { ...content, sha256: learningHash(content) })
    tamper(memory, ['learning', 'trials', `${trial.id}.json`], 'recipe.parentReflectionId', id)
    await expect(store.trial(trial.id)).rejects.toThrow('ancestry contains a cycle')
  })

  it('rejects rehashed self-parenting and future parent reflections', async () => {
    const { store, memory, project, request } = await evidence()
    const parent = await store.saveReflection(request)
    const recipe = learningRecipe(project)
    recipe.parentReflectionId = parent.id
    const child = await store.saveTrial(recipe, project)
    const parts = ['learning', 'reflections', `${parent.id}.json`]
    tamper(memory, parts, 'trialId', child.id)
    await expect(store.trial(child.id)).rejects.toThrow('earlier reflection')
    memory.put(parts, parent)
    tamper(memory, parts, 'createdAt', new Date(Date.parse(child.createdAt) + 1).toISOString())
    await expect(store.trial(child.id)).rejects.toThrow('earlier reflection')
  })
})

describe('evaluation history and filesystem restrictions', () => {
  it('lists completed reports separately from request-only attempts and rejects missing admissions', async () => {
    const { store, memory, evaluation } = await evidence()
    const incomplete = { ...structuredClone(evaluation), id: 'eval-00000000-0000-4000-8000-000000000002' as RobotEvaluationId }
    putLearningEvaluation(memory, incomplete, false)
    expect(await store.evaluations()).toEqual({ evaluations: [evaluation], incompleteCount: 1 })
    await expect(store.evaluation(incomplete.id)).rejects.toThrow('ENOENT')
    memory.files.delete(memory.path('evaluations', evaluation.id, 'request.json'))
    await expect(store.evaluations()).rejects.toThrow('ENOENT')
  })

  it('preserves and counts an incomplete-horizon report without blocking other valid results', async () => {
    const { store, memory, evaluation } = await evidence()
    const incomplete = structuredClone(evaluation)
    incomplete.id = 'eval-00000000-0000-4000-8000-000000000009' as RobotEvaluationId
    incomplete.episodes[0]!.steps = incomplete.spec.stepsPerEpisode - 1
    putLearningEvaluation(memory, incomplete)
    expect(await store.evaluations()).toEqual({ evaluations: [evaluation], incompleteCount: 1 })
    expect(memory.files.has(memory.path('evaluations', incomplete.id, 'report.json'))).toBe(true)
    await expect(store.evaluation(incomplete.id)).rejects.toThrow('full horizon')
  })

  it('counts a reserved evaluation directory before its admission is published without claiming evidence', async () => {
    const { store, memory, evaluation } = await evidence()
    memory.put(['evaluations', 'eval-00000000-0000-4000-8000-000000000003', '.request-private.tmp'], {})
    expect(await store.evaluations()).toEqual({ evaluations: [evaluation], incompleteCount: 1 })
  })

  it.each(['shipped:alpha_stand', 'shipped:alpha_walking'])('retains standalone %s evaluations without fabricating run ownership', async (policyId) => {
    const { store, memory, evaluation } = await evidence()
    evaluation.policyId = evaluation.spec.policyId = policyId as typeof evaluation.policyId
    evaluation.observationProfile = 'microduck-standard-61'
    putLearningEvaluation(memory, evaluation)
    expect(await store.evaluation(evaluation.id)).toEqual(evaluation)
    expect((await store.evaluations()).evaluations).toEqual([evaluation])
  })

  it('checks actual completed run ownership while reading evaluation history', async () => {
    const { store, memory, run, evaluation } = await evidence()
    memory.files.delete(memory.path('runs', run.id, 'manifest.json'))
    await expect(store.evaluation(evaluation.id)).rejects.toThrow('ENOENT')
    await expect(store.evaluations()).rejects.toThrow('ENOENT')
    memory.put(['runs', run.id, 'manifest.json'], { ...run, policySha256: '0'.repeat(64) })
    await expect(store.evaluations()).rejects.toThrow('completed run policy')
  })

  it('does not classify corrupt admission/report pairs as incomplete evidence', async () => {
    const { store, memory, evaluation } = await evidence()
    memory.put(['evaluations', evaluation.id, 'report.json'], { ...evaluation, passed: !evaluation.passed })
    await expect(store.evaluations()).rejects.toThrow('computed criteria')
    memory.files.delete(memory.path('evaluations', evaluation.id, 'report.json'))
    memory.put(['evaluations', evaluation.id, 'request.json'], { id: evaluation.id })
    await expect(store.evaluations()).rejects.toThrow('missing fields')
  })

  it('checks evaluation directory identities, exact record count, and all history filenames', async () => {
    const { store, memory, evaluation, limits } = await evidence()
    const second = { ...structuredClone(evaluation), id: 'eval-00000000-0000-4000-8000-000000000002' as RobotEvaluationId }
    putLearningEvaluation(memory, second, false)
    limits.maxEvaluationRecords = 2
    expect((await store.evaluations()).incompleteCount).toBe(1)
    limits.maxEvaluationRecords = 1
    await expect(store.evaluations()).rejects.toThrow('record count')
    limits.maxEvaluationRecords = 3
    memory.put(['evaluations', 'unexpected', 'request.json'], {})
    await expect(store.evaluations()).rejects.toThrow('identity')
    memory.files.delete(memory.path('evaluations', 'unexpected', 'request.json'))
    const admission = memory.json('evaluations', second.id, 'request.json') as Record<string, unknown>
    memory.put(['evaluations', second.id, 'request.json'], { ...admission, id: evaluation.id })
    await expect(store.evaluations()).rejects.toThrow('directory')
    memory.put(['learning', 'trials', 'unexpected.txt'], {})
    await expect(store.trialIds()).rejects.toThrow('identity')
  })

  it('returns empty collections without creating directories', async () => {
    const { store, memory } = setup()
    expect(await store.trialIds()).toEqual([])
    expect(await store.reflections()).toEqual([])
    expect(await store.evaluations()).toEqual({ evaluations: [], incompleteCount: 0 })
    expect(memory.methods.writeText).not.toHaveBeenCalled()
  })

  it.each(['symlink', 'other'] as const)('rejects %s entries at root, directory, and file before reading', async (kind) => {
    for (const parts of [[], ['projects'], ['projects', `${learningProject().id}.json`]]) {
      const { store, memory, project } = setup()
      memory.special.set(memory.path(...parts), kind)
      await expect(store.project(project.id)).rejects.toThrow('symbolic links or special files')
      expect(memory.methods.readBytes).not.toHaveBeenCalled()
    }
  })

  it.each(['symlink', 'other'] as const)('rejects %s ancestors between the workspace and nested storage root', async (kind) => {
    const { limits, project } = setup()
    const memory = memoryLearningFs('/owned/projects/robot/session')
    memory.put(['projects', `${project.id}.json`], project)
    memory.special.set('/owned/projects', kind)
    const store = new LearningStore(memory.fs, memory.root, { mode: 'workspace-write', workspaceRoot: '/owned' }, limits, new AbortController().signal)
    await expect(store.project(project.id)).rejects.toThrow('symbolic links or special files')
    expect(memory.methods.lstat).toHaveBeenCalledWith('/owned/projects', undefined, expect.any(AbortSignal))
    expect(memory.methods.readBytes).not.toHaveBeenCalled()
    expect(memory.methods.writeText).not.toHaveBeenCalled()
  })

  it.each(['/outside/store', '/owned-sibling/store'])('rejects storage root %s outside the exact workspace', async (root) => {
    const { limits, project } = setup()
    const memory = memoryLearningFs(root)
    memory.put(['projects', `${project.id}.json`], project)
    const store = new LearningStore(memory.fs, root, { mode: 'workspace-write', workspaceRoot: '/owned' }, limits, new AbortController().signal)
    await expect(store.project(project.id)).rejects.toThrow('escapes the session workspace')
    expect(memory.methods.lstat).not.toHaveBeenCalled()
    expect(memory.methods.readBytes).not.toHaveBeenCalled()
    expect(memory.methods.writeText).not.toHaveBeenCalled()
  })

  it('checks every ordinary ancestor below the workspace for a nested project read', async () => {
    const { limits, project } = setup()
    const memory = memoryLearningFs('/owned/projects/robot/session')
    memory.put(['projects', `${project.id}.json`], project)
    const controller = new AbortController()
    const store = new LearningStore(memory.fs, memory.root, { mode: 'workspace-write', workspaceRoot: '/owned' }, limits, controller.signal)
    expect(await store.project(project.id)).toEqual(project)
    expect(memory.methods.lstat.mock.calls).toEqual([
      '/owned/projects', '/owned/projects/robot', '/owned/projects/robot/session',
      '/owned/projects/robot/session/projects', memory.path('projects', `${project.id}.json`),
    ].map(path => [path, undefined, controller.signal]))
  })

  it('rejects resolution escaping the session even when lstat reports ordinary files', async () => {
    const { store, memory, project } = setup()
    memory.aliases.set(memory.path('projects', `${project.id}.json`), '/outside/project.json')
    await expect(store.project(project.id)).rejects.toThrow('escapes this session')
    expect(memory.methods.readBytes).not.toHaveBeenCalled()
  })

  it('rejects linked write directories and malformed traversal identities', async () => {
    const { store, memory, project } = setup()
    memory.special.set(memory.path('learning', 'trials'), 'symlink')
    await expect(store.saveTrial(learningRecipe(project), project)).rejects.toThrow('symbolic links')
    expect(memory.methods.writeText).not.toHaveBeenCalled()
    await expect(store.trial('../trial-00000000-0000-4000-8000-000000000001' as RobotTrialId)).rejects.toThrow('identity')
  })

  it('reads with the inclusive complete-record byte bound and rejects invalid UTF-8 and JSON', async () => {
    const { store, memory, project, limits, controller } = setup()
    const path = memory.path('projects', `${project.id}.json`)
    const bytes = memory.files.get(path)!
    limits.maxLearningRecordBytes = bytes.length
    expect(await store.project(project.id)).toEqual(project)
    expect(memory.methods.readBytes).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayPath: path }), controller.signal, bytes.length,
    )
    limits.maxLearningRecordBytes -= 1
    await expect(store.project(project.id)).rejects.toThrow('FS_TOO_LARGE')
    memory.files.set(path, new Uint8Array([0xff]))
    await expect(store.project(project.id)).rejects.toThrow()
    memory.files.set(path, new TextEncoder().encode('{'))
    await expect(store.project(project.id)).rejects.toThrow()
  })

  it('bounds all report bytes including multibyte limitations', async () => {
    const { store, memory, evaluation, limits } = await evidence()
    evaluation.limitations = ['🦆'.repeat(3000)]
    putLearningEvaluation(memory, evaluation)
    const size = memory.files.get(memory.path('evaluations', evaluation.id, 'report.json'))!.length
    limits.maxLearningRecordBytes = size
    expect(await store.evaluation(evaluation.id)).toEqual(evaluation)
    limits.maxLearningRecordBytes = size - 1
    await expect(store.evaluations()).rejects.toThrow('FS_TOO_LARGE')
  })

  it('measures multibyte brief text in complete saved-record bytes rather than string length', async () => {
    const { store, memory, project, limits } = setup()
    const recipe = learningRecipe(project)
    recipe.brief.evidence = '🦆'.repeat(1500)
    const first = await store.saveTrial(recipe, project)
    const bytes = memory.files.get(memory.path('learning', 'trials', `${first.id}.json`))!
    expect(bytes.length).toBeGreaterThan(JSON.stringify(first).length + 1)
    expect(bytes.length).toBeGreaterThan(memory.files.get(memory.path('projects', `${project.id}.json`))!.length)
    limits.maxLearningRecordBytes = bytes.length - 1
    memory.methods.writeText.mockClear()
    await expect(store.saveTrial(recipe, project)).rejects.toThrow('maxLearningRecordBytes')
    expect(memory.methods.writeText).not.toHaveBeenCalled()
    limits.maxLearningRecordBytes = bytes.length
    expect((await store.saveTrial(recipe, project)).recipe.brief.evidence).toBe(recipe.brief.evidence)
  })

  it('bounds complete writes before publication, including the trailing newline', async () => {
    const { store, memory, project, limits } = setup()
    const trial = await store.saveTrial(learningRecipe(project), project)
    const run = learningRun(trial, project)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(trial.createdAt))
    const content = { version: 1, trialId: trial.id, trialSha256: trial.sha256, runId: run.id,
      recipeHash: run.recipeHash, createdAt: new Date().toISOString() }
    const expected = { ...content, sha256: learningHash(content) }
    const size = Buffer.byteLength(JSON.stringify(expected) + '\n')
    limits.maxLearningRecordBytes = size - 1
    memory.methods.writeText.mockClear()
    await expect(store.bind(trial, run)).rejects.toThrow('maxLearningRecordBytes')
    expect(memory.methods.writeText).not.toHaveBeenCalled()
    limits.maxLearningRecordBytes = size
    expect(await store.bind(trial, run)).toEqual(expected)
  })

  it('permits read-only history but refuses trial, reflection and binding publication', async () => {
    const { memory, limits, trial, run, project, request } = await evidence()
    const store = new LearningStore(memory.fs, memory.root, { mode: 'read-only', workspaceRoot: '/owned' }, limits, new AbortController().signal)
    memory.methods.writeText.mockClear()
    expect(await store.trial(trial.id)).toEqual(trial)
    await expect(store.saveTrial(learningRecipe(project), project)).rejects.toThrow('writable session')
    await expect(store.bind(trial, run)).rejects.toThrow('writable session')
    await expect(store.saveReflection(request)).rejects.toThrow('writable session')
    expect(memory.methods.writeText).not.toHaveBeenCalled()
  })

  it('constrains writes from a permissive session to workspace-write and observes cancellation before IO', async () => {
    const { store, memory, project, controller } = setup({}, 'danger-full-access')
    await store.saveTrial(learningRecipe(project), project)
    expect(memory.methods.writeText.mock.calls[0]?.[4]).toEqual({ mode: 'workspace-write', workspaceRoot: '/owned' })
    memory.methods.resolve.mockClear()
    controller.abort(new Error('cancelled operation'))
    await expect(store.project(project.id)).rejects.toThrow('cancelled operation')
    expect(memory.methods.resolve).not.toHaveBeenCalled()
  })
})

describe('learning deployment configuration', () => {
  it('provides explicit positive record, byte and Unicode text defaults', () => {
    const config = Config({ sourceRoot: '/configured/lab', pythonBin: '/configured/python' })
    expect(config).toMatchObject({ maxTrials: 100, maxReflections: 100, maxEvaluationRecords: 200,
      maxLearningRecordBytes: 1024 * 1024, maxLearningTextLength: 2000 })
  })

  it.each(['maxTrials', 'maxReflections', 'maxEvaluationRecords', 'maxLearningRecordBytes', 'maxLearningTextLength'] as const)('rejects invalid %s configuration at provider construction', (key) => {
    for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const config = Config({ sourceRoot: '/configured/lab', pythonBin: '/configured/python' })
      config[key] = value
      expect(() => new MicroduckProvider(new Context(), config)).toThrow('positive safe integer')
    }
  })
})
