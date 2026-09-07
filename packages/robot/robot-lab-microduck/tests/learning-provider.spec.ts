import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RobotEvaluation, RobotLabRequest, RobotPolicyId, RobotRun, RobotRunId, RobotSimulation, RobotTrainingSpec, RobotTrial } from '@deepseek-ai/dsh-robot-lab'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { Config, MicroduckProvider } from '../src/index.ts'
import { learningEvaluation, learningProject, learningRecipe, learningRun, learningDanceCriteria,
  learningDancePlan, memoryLearningFs, putLearningEvaluation } from './learning-fixtures.ts'
import { learningHash } from '../src/learning-store.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function harness(options: {
  mode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  config?: Partial<Config>
  bindingFailure?: boolean
  spawnFailure?: boolean
  bindingGate?: Promise<unknown>
  beforeBinding?: () => void
  changeProjectAfterValidation?: boolean
  dance?: boolean
  omitDancePlan?: boolean
  changeDanceCriteria?: boolean
} = {}) {
  const owner = Session.create(SessionId('learning-provider-owner'))
  const workspaceRoot = '/owned'
  const root = `${workspaceRoot}/.microduck-studio/${createHash('sha256').update(owner.id).digest('hex')}`
  const memory = memoryLearningFs(root)
  const project = learningProject()
  memory.put(['projects', `${project.id}.json`], project)
  let trial: RobotTrial | undefined
  let run: RobotRun | undefined
  const exit = deferred<SubprocessOutcome>()
  const started = deferred<boolean>()
  const tree = deferred<boolean>()
  const requests: Array<{ operation: string; python: string | undefined; request: Record<string, unknown> }> = []
  const write = memory.methods.writeText.getMockImplementation()!
  memory.methods.writeText.mockImplementation(async (target, content, intent, signal, policy) => {
    if (target.displayPath.includes('/bindings/')) {
      options.beforeBinding?.()
      if (options.bindingGate !== undefined) await options.bindingGate
      if (options.bindingFailure) throw new Error('binding write failed')
    }
    return write(target, content, intent, signal, policy)
  })
  const context = {
    fs: memory.fs,
    sandboxPolicy: { resolve: () => ({ mode: options.mode ?? 'workspace-write', workspaceRoot, sessionId: owner.id }) },
    sandbox: { confine: (argv: string[]) => ({ argv, enforcement: 'full' }) },
    logger: { error: vi.fn() },
    subprocess: {
      resolveExecutable: async (path: string) => path,
      spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
        if (typeof spec.stdio.stdin === 'string') throw new Error('Expected bridge JSON')
        const { request } = JSON.parse(spec.stdio.stdin.data) as { request: Record<string, unknown> }
        const operation = String(request.operation)
        requests.push({ operation, python: spec.argv[0], request })
        if (operation === 'behaviors' && options.changeProjectAfterValidation) {
          memory.put(['projects', `${project.id}.json`], { ...project, sha256: '9'.repeat(64) })
        }
        let result: unknown
        if (operation === 'project') result = { operation, project }
        else if (operation === 'behaviors') result = { operation, behaviors: [{ id: 'imitate', label: 'Imitate', description: '', defaultSteps: 256,
          terms: [{ key: 'travel', label: 'Travel', weight: 0, penalty: false }, { key: 'pose', label: 'Pose', weight: 1, penalty: false }] }] }
        else if (operation === 'prepare_train') {
          if (trial === undefined) throw new Error('Test requires saved trial')
          run = { ...learningRun(trial, project), id: request.runId as RobotRunId, state: 'starting', finishedAt: null,
            spec: { ...request.spec as RobotTrainingSpec, clip: project.clip, projectSnapshot: project },
            policyId: null, policySha256: null }
          if (options.dance && !options.omitDancePlan) {
            run.dancePlan = learningDancePlan(trial, run)
            if (options.changeDanceCriteria) run.dancePlan.evaluation.dance.minReferenceGainRatio = 0.75
          }
          memory.put(['runs', run.id, 'manifest.json'], run)
          result = { operation: 'train', run }
        } else if (operation === 'train') {
          if (trial === undefined || run === undefined) throw new Error('Test requires prepared run')
          expect(memory.files.has(memory.path('learning', 'bindings', `${trial.id}.json`))).toBe(true)
          if (options.spawnFailure) throw new Error('trainer spawn failed')
          started.resolve(true)
        } else if (operation === 'run') {
          if (run === undefined) throw new Error('No prepared run')
          const state = memory.files.has(memory.path('runs', run.id, 'state.json'))
            ? memory.json('runs', run.id, 'state.json') as Partial<RobotRun> : {}
          result = { operation, run: { ...memory.json('runs', run.id, 'manifest.json') as RobotRun, ...state } }
        } else if (operation === 'evaluate') {
          if (trial === undefined || run === undefined) throw new Error('No completed run')
          const evaluation = learningEvaluation(trial, run)
          expect(request.spec).toEqual(evaluation.spec)
          putLearningEvaluation(memory, evaluation)
          result = { operation, evaluation }
        } else if (operation === 'simulate') {
          if (trial === undefined || run === undefined) throw new Error('No completed run')
          const evaluation = learningEvaluation(trial, run)
          const simulation: RobotSimulation = { mode: 'recorded-simulation', policyId: evaluation.policyId, policyHash: evaluation.policyHash,
            observationProfile: run.observationProfile, controlHz: 50, physics: evaluation.physics, bamSettings: {}, frames: [] }
          result = { operation, simulation }
        } else throw new Error(`Unexpected bridge operation ${operation}`)
        const active = operation === 'train'
        const handle: SubprocessHandle = {
          pid: 1, stdin: undefined, stdout: undefined, stderr: undefined,
          collected: { stdout: { readFrom: () => ({ text: JSON.stringify(active ? { operation: 'train', run } : result), nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
          done: active ? exit.promise : Promise.resolve({ exitCode: 0, signal: null }),
          waitForExit: async () => active ? tree.promise : true,
          terminate: () => { if (active) exit.resolve({ exitCode: null, signal: 'SIGTERM' }) },
        }
        spec.signal?.addEventListener('abort', () => { handle.terminate() }, { once: true })
        return handle
      },
    },
  } as unknown as Context
  const config = Config({ sourceRoot: '/installed/lab', pythonBin: '/installed/python',
    ...(options.dance ? { maxSimulationSteps: 2000 } : {}), ...options.config })
  const provider = new MicroduckProvider(context, config)
  const execute = (request: RobotLabRequest, signal = new AbortController().signal) => provider.execute(owner, request, signal)
  async function save() {
    const recipe = learningRecipe(project)
    if (options.dance) recipe.evaluation = { ...recipe.evaluation, stepsPerEpisode: 2000, dance: learningDanceCriteria() }
    const result = await execute({ operation: 'save_trial', recipe })
    if (result.operation !== 'save_trial') throw new Error('Expected trial')
    trial = result.trial
    return trial
  }
  function finish() {
    if (run === undefined) throw new Error('Expected prepared run')
    run = { ...run, state: 'completed', finishedAt: new Date().toISOString(), policyId: `run:${run.id}` as RobotPolicyId, policySha256: 'e'.repeat(64) }
    memory.put(['runs', run.id, 'manifest.json'], run)
    exit.resolve({ exitCode: 0, signal: null }); tree.resolve(true)
  }
  return { provider, execute, save, finish, memory, project, requests, started, tree, exit,
    getRun: () => run!, getTrial: () => trial!, cleanup: async () => { tree.resolve(true); await provider.dispose() } }
}

describe('host-only learning provider', () => {
  it('saves the plan before CPU training, binds before spawn, and preserves frozen assessment through reflection and new simulation', async () => {
    const h = harness()
    try {
      const trial = await h.save()
      expect(trial.recipe.spec.backend).toBe('cpu')
      expect(trial.recipe.brief.evidence).toBeTypeOf('string')
      expect(h.requests.map(value => value.operation)).toEqual(['project', 'behaviors'])
      expect(await h.execute({ operation: 'trials' })).toMatchObject({ trials: [{ trial, binding: null, run: null }] })
      const admitted = await h.execute({ operation: 'train_trial', trialId: trial.id })
      expect(admitted).toMatchObject({ operation: 'train_trial', trial, run: { state: 'starting', formatVersion: 3 } })
      expect(h.requests.slice(-2).map(value => [value.operation, value.python])).toEqual([['prepare_train', '/installed/python'], ['train', '/installed/python']])
      expect(h.requests.at(-2)?.request.spec).toEqual(trial.recipe.spec)
      h.finish()
      const evaluated = await h.execute({ operation: 'evaluate_trial', trialId: trial.id })
      if (evaluated.operation !== 'evaluate_trial') throw new Error('Expected evaluated trial')
      expect(await h.execute({ operation: 'evaluations' })).toEqual({ operation: 'evaluations', evaluations: [evaluated.evaluation], incompleteCount: 0 })
      const reflection = await h.execute({ operation: 'save_reflection', reflection: { trialId: trial.id, evaluationId: evaluated.evaluation.id,
        observation: 'Stayed upright', interpretation: 'Smaller motion helped', nextChange: 'Try more steps' } })
      expect(reflection).toMatchObject({ operation: 'save_reflection', reflection: { trialId: trial.id, runId: h.getRun().id, policyHash: h.getRun().policySha256 } })
      expect(await h.execute({ operation: 'reflections' })).toMatchObject({ reflections: [expect.objectContaining({ trialId: trial.id })] })
      const replayed = await h.execute({ operation: 'replay_evaluation', evaluationId: evaluated.evaluation.id, episodeIndex: 1 })
      expect(replayed).toMatchObject({ mode: 'new-resimulation', simulation: { policyHash: evaluated.evaluation.policyHash } })
      expect(h.requests.at(-1)?.request).toEqual({ operation: 'simulate', policyId: evaluated.evaluation.policyId,
        seed: trial.recipe.evaluation.seed + 1, steps: trial.recipe.evaluation.stepsPerEpisode, command: [0, 0, 0] })
      expect(h.memory.methods.writeText.mock.calls.filter(call => call[0].displayPath.includes('/learning/')).every(call => call[2]?.kind === 'createIfAbsent')).toBe(true)
    } finally { await h.cleanup() }
  })
  it('binds the entire resolved dance plan before starting the learner', async () => {
    const h = harness({ dance: true })
    try {
      const trial = await h.save()
      await h.execute({ operation: 'train_trial', trialId: trial.id })
      const prepared = h.requests.find(value => value.operation === 'prepare_train')
      expect(prepared?.request.evaluation).toEqual(trial.recipe.evaluation)
      const binding = h.memory.json('learning', 'bindings', `${trial.id}.json`)
      expect(binding).toMatchObject({ dancePlanSha256: learningHash(h.getRun().dancePlan) })
      expect(h.requests.some(value => value.operation === 'train')).toBe(true)
    } finally { await h.cleanup() }
  })
  it.each(['missing', 'changed'] as const)('rejects a %s resolved dance assessment before learner creation', async (kind) => {
    const h = harness({ dance: true, omitDancePlan: kind === 'missing', changeDanceCriteria: kind === 'changed' })
    try {
      const trial = await h.save()
      await expect(h.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow('Run dance plan differs')
      expect(h.requests.some(value => value.operation === 'train')).toBe(false)
      expect(h.memory.files.has(h.memory.path('learning', 'bindings', `${trial.id}.json`))).toBe(false)
    } finally { await h.cleanup() }
  })
  it('rejects changed scientific inputs even when the opaque Python digest is retained', async () => {
    const h = harness({ dance: true })
    try {
      const trial = await h.save()
      await h.execute({ operation: 'train_trial', trialId: trial.id })
      h.finish()
      const run = structuredClone(h.getRun())
      if (run.dancePlan === undefined) throw new Error('Expected resolved plan')
      run.dancePlan.reference.sampledSha256 = '7'.repeat(64)
      h.memory.put(['runs', run.id, 'manifest.json'], run)
      await expect(h.execute({ operation: 'trials' })).rejects.toThrow('Trial binding dance plan hash differs')
    } finally { await h.cleanup() }
  })
  it('refuses project replacement between Python validation and host trial publication', async () => {
    const h = harness({ changeProjectAfterValidation: true })
    try {
      await expect(h.save()).rejects.toThrow('changed after Python validation')
      expect(h.memory.methods.writeText).not.toHaveBeenCalled()
      expect(h.requests.map(value => value.operation)).toEqual(['project', 'behaviors'])
    } finally { await h.cleanup() }
  })
  it('holds one admission per trial even when training capacity exceeds one', async () => {
    const reached = deferred<boolean>(); const release = deferred<boolean>()
    const h = harness({ config: { maxConcurrentTraining: 2 }, bindingGate: release.promise,
      beforeBinding: () => { reached.resolve(true) } })
    try {
      const trial = await h.save()
      const pending = h.execute({ operation: 'train_trial', trialId: trial.id })
      await reached.promise
      await expect(h.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow('already in progress')
      release.resolve(true); await pending
      await expect(h.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow('already in progress')
      expect(h.requests.filter(value => value.operation === 'prepare_train')).toHaveLength(1)
    } finally { release.resolve(true); await h.cleanup() }
  })
  it.each(['binding', 'spawn'] as const)('settles preparation when %s fails and never publishes successful admission', async (failure) => {
    const h = harness({ bindingFailure: failure === 'binding', spawnFailure: failure === 'spawn' })
    try {
      const trial = await h.save()
      await expect(h.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow(failure === 'binding' ? 'binding write failed' : 'trainer spawn failed')
      expect(h.memory.json('runs', h.getRun().id, 'state.json')).toMatchObject({ state: 'failed' })
      if (failure === 'binding') expect(h.requests.some(value => value.operation === 'train')).toBe(false)
      else await expect(h.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow('save a new trial')
    } finally { await h.cleanup() }
  })
  it('cancellation during binding cannot start a trainer', async () => {
    const reached = deferred<boolean>(); const release = deferred<boolean>(); const controller = new AbortController()
    const h = harness({ bindingGate: release.promise, beforeBinding: () => { reached.resolve(true) } })
    try {
      const trial = await h.save()
      const pending = h.execute({ operation: 'train_trial', trialId: trial.id }, controller.signal)
      await reached.promise; controller.abort(); release.resolve(true)
      await expect(pending).rejects.toThrow()
      expect(h.requests.some(value => value.operation === 'train')).toBe(false)
      expect(h.memory.json('runs', h.getRun().id, 'state.json')).toMatchObject({ state: 'failed' })
    } finally { release.resolve(true); await h.cleanup() }
  })
  it('disposal drains a pending binding without launching a trainer', async () => {
    const reached = deferred<boolean>(); const release = deferred<boolean>()
    const h = harness({ bindingGate: release.promise, beforeBinding: () => { reached.resolve(true) } })
    try {
      const trial = await h.save()
      const pending = h.execute({ operation: 'train_trial', trialId: trial.id })
      await reached.promise
      let settled = false
      const disposing = h.provider.dispose().then(() => { settled = true })
      expect(settled).toBe(false)
      release.resolve(true)
      await expect(pending).rejects.toThrow()
      await disposing
      expect(h.requests.some(value => value.operation === 'train')).toBe(false)
      expect(h.memory.json('runs', h.getRun().id, 'state.json')).toMatchObject({ state: 'stopped' })
    } finally { release.resolve(true); await h.cleanup() }
  })
  it('keeps admitted training after caller disconnect and disposal waits for whole-tree exit', async () => {
    const h = harness(); const controller = new AbortController()
    try {
      const trial = await h.save()
      await h.execute({ operation: 'train_trial', trialId: trial.id }, controller.signal)
      controller.abort()
      expect(h.memory.files.has(h.memory.path('runs', h.getRun().id, 'state.json'))).toBe(false)
      let settled = false
      const disposing = h.provider.dispose().then(() => { settled = true })
      await h.exit.promise
      expect(settled).toBe(false)
      h.tree.resolve(true); await disposing
      expect(h.memory.json('runs', h.getRun().id, 'state.json')).toMatchObject({ state: 'stopped' })
    } finally { await h.cleanup() }
  })
  it('refuses read-only mutations before filesystem writes or Python calls', async () => {
    const h = harness({ mode: 'read-only' })
    try {
      const trialId = 'trial-00000000-0000-4000-8000-000000000001' as RobotTrial['id']
      for (const request of [{ operation: 'save_trial', recipe: learningRecipe() }, { operation: 'train_trial', trialId },
        { operation: 'evaluate_trial', trialId }, { operation: 'save_reflection', reflection: { trialId,
          evaluationId: 'eval-00000000-0000-4000-8000-000000000001' as RobotEvaluation['id'], observation: 'Seen', interpretation: 'Reason', nextChange: 'Change' } }] satisfies RobotLabRequest[]) {
        await expect(h.execute(request)).rejects.toThrow('writable')
      }
      expect(h.requests).toEqual([]); expect(h.memory.methods.writeText).not.toHaveBeenCalled()
    } finally { await h.cleanup() }
  })
  it('applies host response byte bounds and narrows permissive session writes', async () => {
    const h = harness({ mode: 'danger-full-access', config: { maxOutputBytes: 5000 } })
    try {
      const trial = await h.save()
      expect(h.memory.methods.writeText.mock.calls.at(-1)?.[4]?.mode).toBe('workspace-write')
      await expect(h.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow('maxOutputBytes')
      expect(h.requests.some(value => value.operation === 'train')).toBe(false)
    } finally { await h.cleanup() }
  })
  it('re-simulates an early-terminated episode with its requested horizon, not its measured length', async () => {
    const h = harness()
    try {
      const trial = await h.save()
      await h.execute({ operation: 'train_trial', trialId: trial.id }); h.finish()
      const evaluation = learningEvaluation(trial, h.getRun())
      evaluation.episodes[0]!.terminated = true; evaluation.episodes[0]!.steps = 5; evaluation.passed = false
      putLearningEvaluation(h.memory, evaluation)
      const replay = await h.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })
      expect(replay).toMatchObject({ mode: 'new-resimulation' })
      expect(h.requests.at(-1)?.request.steps).toBe(trial.recipe.evaluation.stepsPerEpisode)
      await expect(h.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 9 })).rejects.toThrow('episodeIndex')
      const calls = h.requests.length
      evaluation.policyHash = '9'.repeat(64); putLearningEvaluation(h.memory, evaluation)
      await expect(h.execute({ operation: 'replay_evaluation', evaluationId: evaluation.id, episodeIndex: 0 })).rejects.toThrow('policy')
      expect(h.requests).toHaveLength(calls)
    } finally { await h.cleanup() }
  })
  it('restores saved history and marks ownerless runs interrupted without changing manifests', async () => {
    const h = harness(); const resumed = harness()
    try {
      const trial = await h.save()
      await h.execute({ operation: 'train_trial', trialId: trial.id })
      const durable = new Map(h.memory.files)
      await h.cleanup()
      resumed.memory.files.clear()
      for (const [path, bytes] of durable) resumed.memory.files.set(path, bytes)
      const manifestPath = resumed.memory.path('runs', h.getRun().id, 'manifest.json')
      const before = resumed.memory.files.get(manifestPath)
      expect(await resumed.execute({ operation: 'trials' })).toMatchObject({ trials: [{ trial, run: { state: 'interrupted' } }] })
      expect(resumed.memory.files.get(manifestPath)).toEqual(before)
      expect(resumed.requests).toEqual([])
      await expect(resumed.execute({ operation: 'train_trial', trialId: trial.id })).rejects.toThrow('save a new trial')
    } finally { await h.cleanup(); await resumed.cleanup() }
  })
  it('serializes saved-record admission and enforces retention without pruning', async () => {
    const h = harness({ config: { maxTrials: 1 } })
    try {
      const results = await Promise.allSettled([h.save(), h.save()])
      expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(value => value.status === 'rejected')).toHaveLength(1)
      await expect(h.save()).rejects.toThrow('Maximum saved trials')
      expect(await h.execute({ operation: 'trials' })).toMatchObject({ trials: [expect.objectContaining({ trial: h.getTrial() })] })
    } finally { await h.cleanup() }
  })
  it('retains the existing choreography compiler and standalone MLX learner', async () => {
    const hashes = { 'studio.py': '65252813c5cf15e5bae908b666c929660ecc73be9deda096b567ea789a23e0d1',
      'mlx_ppo.py': '2306c24f8a2d8457e3cd8ad1ab37edd7e0852a1e5bf6f37e04bbada2a4a4b7db' }
    for (const [name, expected] of Object.entries(hashes)) {
      const bytes = await readFile(new URL(`../python/${name}`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected)
    }
  })
})
