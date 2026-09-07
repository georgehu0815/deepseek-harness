import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RobotProjectRecipe, RobotRlxProgress } from '@deepseek-ai/dsh-robot-lab'
import { Config, MicroduckProvider, parseReply } from '../src/index.ts'

function config(overrides: Partial<Config> = {}): Config {
  return Object.assign(Config({ sourceRoot: '/configured/lab', pythonBin: '/configured/python' }), overrides)
}

function runFixture() {
  return {
    formatVersion: 3, id: 'run-00000000-0000-0000-0000-000000000000', state: 'completed',
    createdAt: '2026-09-04T00:00:00Z', finishedAt: '2026-09-04T00:01:00Z',
    spec: { backend: 'mlx', name: 'Metal stand', behaviorId: 'stand', steps: 256, envs: 1, seed: 0, actuator: 'bam', weights: {}, clip: null },
    observationProfile: 'microduck-standard-61', recipeHash: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64),
    progress: null, error: null, policyId: 'run:run-00000000-0000-0000-0000-000000000000', policySha256: 'c'.repeat(64),
    provenance: {
      bridgeSha256: 'd'.repeat(64), dependencyVersions: { mujoco: '3.10.0' },
      bam: { source: 'fixture', parameters: { kt: 0.36 }, sha256: 'e'.repeat(64) },
      environment: { domainRandomization: false, randomYaw: false, standingSpawns: true, assistance: false, updateDevice: 'metal', observationNoise: true, actionDelay: true },
      trainer: { backend: 'mlx', learnerDevice: 'metal', physicsDevice: 'cpu', pythonVersion: '3.12.7', platform: 'Darwin', architecture: 'arm64', hardware: 'Apple fixture GPU',
        dependencyVersions: { mlx: '0.31.1' }, helperSha256: { 'mlx_ppo.py': 'f'.repeat(64) }, recipe: { algorithm: 'dsh-mlx-ppo-v1' }, sha256: '1'.repeat(64) },
    },
  }
}

describe('RLX progress process replies', () => {
  function telemetry(): RobotRlxProgress {
    return { version: 1, completedRollouts: 1, optimizerSteps: 4, lastMeanLoss: -0.125,
      collectionSeconds: 0.1, updateSeconds: 0.2, checkpointSeconds: null, exportSeconds: null }
  }
  function runWithProgress() {
    const run = runFixture()
    return { ...run, spec: { ...run.spec, backend: 'rlx' },
      artifactSha256: { 'rlx-artifacts.json': 'a'.repeat(64) },
      provenance: { ...run.provenance, trainer: { ...run.provenance.trainer, backend: 'rlx',
        helperSha256: { 'rlx_ppo.py': 'b'.repeat(64) }, recipe: { version: 'rlx-microduck-ppo-v1' } } },
      progress: { steps: 128, total: 256, elapsedSeconds: 0.3, reward: null, rlx: telemetry() } }
  }
  function source(run: unknown, operation: 'run' | 'runs' = 'run') {
    return JSON.stringify(operation === 'run' ? { operation, run } : { operation, runs: [run], incompatibleRuns: [] })
  }
  function patch(run: unknown, path: string, value: unknown) {
    const keys = path.split('.')
    let row = run as Record<string, unknown>
    for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>
    row[keys.at(-1)!] = value
  }

  it.each(['run', 'runs'] as const)('retains every sampled RLX field through %s JSON without changing its clocks', (operation) => {
    const run = runWithProgress()
    const parsed = parseReply(source(run, operation))
    expect(parsed).toEqual(JSON.parse(source(run, operation)))
    const actual = parsed.operation === 'run' ? parsed.run : parsed.operation === 'runs' ? parsed.runs[0]! : undefined
    expect(actual?.progress).toEqual(run.progress)
    expect(run.progress.rlx.collectionSeconds + run.progress.rlx.updateSeconds).toBeGreaterThan(run.progress.elapsedSeconds)
  })

  it.each([0, 64])('accepts null loss before any completed update at %s collected steps', (steps) => {
    const run = runWithProgress()
    run.progress.steps = steps
    Object.assign(run.progress.rlx, { completedRollouts: 0, optimizerSteps: 0, lastMeanLoss: null,
      collectionSeconds: 0, updateSeconds: 0 })
    expect(parseReply(source(run))).toEqual({ operation: 'run', run })
  })

  it.each([-1, 0, 1])('accepts finite signed or zero objective %s after an update', (lastMeanLoss) => {
    const run = runWithProgress()
    run.progress.rlx.lastMeanLoss = lastMeanLoss
    run.progress.rlx.optimizerSteps = run.progress.rlx.completedRollouts
    expect(parseReply(source(run))).toEqual({ operation: 'run', run })
  })

  it.each(['starting', 'running', 'completed', 'failed', 'stopped', 'interrupted'])('keeps %s state authoritative after checkpoint and export timings complete', (state) => {
    const run = { ...runWithProgress(), state }
    run.progress.steps = run.progress.total
    run.progress.rlx.checkpointSeconds = 10
    run.progress.rlx.exportSeconds = 20
    expect(parseReply(source(run))).toEqual({ operation: 'run', run })
    expect(run.progress.elapsedSeconds).toBe(0.3)
  })

  it('distinguishes completed zero-duration serialization from missing export observations', () => {
    const run = runWithProgress()
    run.progress.steps = run.progress.total
    run.progress.rlx.checkpointSeconds = 0
    expect(parseReply(source(run))).toEqual({ operation: 'run', run })
    run.progress.rlx.exportSeconds = 0
    expect(parseReply(source(run))).toEqual({ operation: 'run', run })
  })

  it.each(['cpu', 'mlx', 'rlx'])('keeps legacy %s runs without RLX telemetry unchanged', (backend) => {
    const base = runWithProgress()
    const { rlx: _rlx, ...progress } = base.progress
    const helpers = backend === 'cpu' ? {} : { [backend === 'rlx' ? 'rlx_ppo.py' : 'mlx_ppo.py']: 'b'.repeat(64) }
    const device = backend === 'cpu' ? 'cpu' : 'metal'
    const run = { ...base, spec: { ...base.spec, backend }, progress,
      provenance: { ...base.provenance, environment: { ...base.provenance.environment, updateDevice: device },
        trainer: { ...base.provenance.trainer, backend, learnerDevice: device, helperSha256: helpers } } }
    if (backend !== 'rlx') Reflect.deleteProperty(run, 'artifactSha256')
    for (const value of [run, { ...run, progress: null }]) {
      expect(parseReply(source(value))).toEqual({ operation: 'run', run: value })
    }
    if (backend !== 'rlx') {
      patch(run, 'progress.rlx', telemetry())
      expect(() => parseReply(source(run))).toThrow('Unexpected RLX progress')
    }
  })

  it.each([null, [], 1, false, {}, { ...telemetry(), extra: true }])('rejects malformed explicit telemetry %j', (rlx) => {
    const run = runWithProgress(); patch(run, 'progress.rlx', rlx)
    expect(() => parseReply(source(run))).toThrow()
  })
  it.each(Object.keys(telemetry()))('rejects missing telemetry field %s', (key) => {
    const run = runWithProgress(); Reflect.deleteProperty(run.progress.rlx, key)
    expect(() => parseReply(source(run))).toThrow('Unexpected RLX progress')
  })
  it('rejects a replacement field even when the field count is unchanged', () => {
    const run = runWithProgress()
    Reflect.deleteProperty(run.progress.rlx, 'lastMeanLoss')
    patch(run, 'progress.rlx.loss', 0)
    expect(() => parseReply(source(run))).toThrow('Unexpected RLX progress')
  })
  it.each([0, 2, null, '1'])('rejects unknown telemetry version %j', (version) => {
    const run = runWithProgress(); patch(run, 'progress.rlx.version', version)
    expect(() => parseReply(source(run))).toThrow('version')
  })

  it.each(['rlx.completedRollouts', 'rlx.optimizerSteps', 'steps', 'total'])('rejects invalid safe counts at progress.%s', (field) => {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, true, '1', null]) {
      const run = runWithProgress(); patch(run, `progress.${field}`, value)
      expect(() => parseReply(source(run))).toThrow(/safe step counts|finite number/)
    }
  })
  it.each([
    ['rollouts exceed collected steps', { completedRollouts: 129, optimizerSteps: 129 }],
    ['optimizer steps below rollouts', { optimizerSteps: 0 }],
    ['null loss after updates', { lastMeanLoss: null }],
    ['loss without completed rollouts', { completedRollouts: 0, optimizerSteps: 0 }],
    ['optimizer steps without completed rollouts', { completedRollouts: 0, optimizerSteps: 1, lastMeanLoss: null }],
  ])('rejects inconsistent observations: %s', (_label, fields) => {
    const run = runWithProgress(); Object.assign(run.progress.rlx, fields)
    expect(() => parseReply(source(run))).toThrow('counts and last loss disagree')
  })
  it('rejects collected steps beyond the training budget', () => {
    const run = runWithProgress(); run.progress.steps = run.progress.total + 1
    expect(() => parseReply(source(run))).toThrow('counts and last loss disagree')
  })

  it.each(['collectionSeconds', 'updateSeconds', 'checkpointSeconds', 'exportSeconds'])('rejects negative progress.rlx.%s', (field) => {
    const run = runWithProgress(); run.progress.steps = run.progress.total
    patch(run, `progress.rlx.${field}`, -0.1)
    expect(() => parseReply(source(run))).toThrow(/timings|training budget/)
  })
  it.each(['lastMeanLoss', 'collectionSeconds', 'updateSeconds', 'checkpointSeconds', 'exportSeconds'])('rejects nonfinite JSON numbers at progress.rlx.%s', (field) => {
    for (const token of ['1e400', '-1e400']) {
      const run = runWithProgress(); run.progress.steps = run.progress.total
      patch(run, `progress.rlx.${field}`, 'overflow-number')
      expect(() => parseReply(source(run).replace('"overflow-number"', token))).toThrow('finite number')
    }
  })
  it.each(['completedRollouts', 'optimizerSteps'])('rejects overflowing JSON count %s', (field) => {
    const run = runWithProgress(); patch(run, `progress.rlx.${field}`, 'overflow-count')
    expect(() => parseReply(source(run).replace('"overflow-count"', '1e400'))).toThrow('safe step counts')
  })
  it.each(['collectionSeconds', 'updateSeconds'])('requires nonnullable collection/update timing %s', (field) => {
    const run = runWithProgress(); patch(run, `progress.rlx.${field}`, null)
    expect(() => parseReply(source(run))).toThrow('finite number')
  })
  it.each(['checkpointSeconds', 'exportSeconds'])('requires a fulfilled budget and completed rollout for %s', (field) => {
    const run = runWithProgress(); patch(run, `progress.rlx.${field}`, 0)
    expect(() => parseReply(source(run))).toThrow('completed training budget')
    run.progress.steps = run.progress.total = 0
    Object.assign(run.progress.rlx, { completedRollouts: 0, optimizerSteps: 0, lastMeanLoss: null })
    expect(() => parseReply(source(run))).toThrow('completed training budget')
  })
  it('rejects completed export without completed checkpoint serialization', () => {
    const run = runWithProgress(); run.progress.steps = run.progress.total
    run.progress.rlx.exportSeconds = 0.1
    expect(() => parseReply(source(run))).toThrow('requires completed checkpoint serialization')
  })
})

describe('MicroDuck provider admission', () => {
  it('requires completed RLX artifacts and its distinct learner helper', () => {
    const run = runFixture()
    const rlx = { ...run, spec: { ...run.spec, backend: 'rlx' },
      artifactSha256: { 'rlx-artifacts.json': 'a'.repeat(64) },
      provenance: { ...run.provenance, trainer: { ...run.provenance.trainer, backend: 'rlx', helperSha256: { 'rlx_ppo.py': 'b'.repeat(64) } } } }
    const reply = { operation: 'run', run: rlx }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    for (const artifactSha256 of [undefined, {}, { 'elsewhere.json': 'a'.repeat(64) }, { 'rlx-artifacts.json': 'bad' }]) {
      expect(() => parseReply(JSON.stringify({ ...reply, run: { ...rlx, artifactSha256 } }))).toThrow()
    }
    expect(() => parseReply(JSON.stringify({ ...reply, run: { ...rlx, provenance: run.provenance } }))).toThrow('backend')
  })
  it('rejects relative installation paths and escaping storage', () => {
    expect(() => new MicroduckProvider(new Context(), config({ sourceRoot: './lab' }))).toThrow('absolute')
    expect(() => new MicroduckProvider(new Context(), config({ mlxPythonBin: './mlx-python' }))).toThrow('absolute')
    expect(() => new MicroduckProvider(new Context(), config({ storageDirectory: '../outside' }))).toThrow('traversal')
    expect(() => new MicroduckProvider(new Context(), config({ storageDirectory: '/outside' }))).toThrow('relative')
    expect(() => new MicroduckProvider(new Context(), config({ timeoutMs: 0 }))).toThrow('positive')
    expect(() => new MicroduckProvider(new Context(), config({ minStudioBpm: 201, maxStudioBpm: 200 }))).toThrow('minStudioBpm')
    for (const studioBeatChoices of [[], [16, 16], [0], [1.5]]) expect(() => new MicroduckProvider(new Context(), config({ studioBeatChoices }))).toThrow('studioBeatChoices')
    for (const studioBlockBeatChoices of [[], [8, 8], [0], [1.5]]) {
      expect(() => new MicroduckProvider(new Context(), config({ studioBlockBeatChoices }))).toThrow('studioBlockBeatChoices')
    }
    expect(() => new MicroduckProvider(new Context(), config({ maxProjectBlocks: 0 }))).toThrow('maxProjectBlocks')
  })
  it('rejects read-only project saves before creating a process', async () => {
    const spawn = vi.fn()
    const ctx = { sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: '/owned' }) },
      fs: { resolve: async (path: string) => path, contains: () => true, processPath: (path: string) => path },
      subprocess: { spawn }, logger: { error: vi.fn() } }
    const provider = new MicroduckProvider(ctx as unknown as Context, config())
    const recipe: RobotProjectRecipe = { projectId: null, name: 'Readonly', profileId: 'microduck' as RobotProjectRecipe['profileId'],
      templateId: 'head-bob' as RobotProjectRecipe['templateId'], templateVersion: 1,
      parameters: { bpm: 96, beats: 32, moveSize: 0.5 }, music: { version: 1, style: 'disco', bpm: 96, beats: 32, seed: 1 } }
    await expect(provider.execute(Session.create(SessionId('read-only-studio')), { operation: 'save_project', recipe }, new AbortController().signal)).rejects.toThrow('writable session')
    expect(spawn).not.toHaveBeenCalled()
    await provider.dispose()
  })
  it('disposes an idle provider without creating processes', async () => {
    const provider = new MicroduckProvider(new Context(), config())
    await provider.dispose()
    await provider.dispose()
  })
  it.each(['null', '{}', '{"operation":"unknown","run":{}}', '{"operation":"runs","runs":null}', '{"operation":"runs","runs":{}}', '{"operation":"prepare","reasons":[],"allowed":true}'])('rejects malformed or physically permissive output: %s', (value) => {
    expect(() => parseReply(value)).toThrow()
  })
  it('preserves explicit runtime incompatibility while rejecting malformed compatibility fields', () => {
    const policy = { id: 'run:historic', name: 'Historical dance', sha256: 'a'.repeat(64),
      observationProfile: 'microduck-lab-body-phase-61', runId: 'historic', verification: 'evaluated',
      runtimeCompatibility: { available: false, reason: 'Python bridge differs from the frozen run provenance' },
      deployment: { available: false, reason: 'Simulation only' } }
    const reply = { operation: 'policies', policies: [policy] }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    for (const runtimeCompatibility of [undefined, { available: 'false', reason: null }, { available: false, reason: 123 }]) {
      expect(() => parseReply(JSON.stringify({ ...reply, policies: [{ ...policy, runtimeCompatibility }] }))).toThrow()
    }
  })
  it('validates independent CPU and optional Metal readiness without enabling deployment', () => {
    const available = { available: true, reason: null }
    const disabled = { available: false, reason: 'Optional MLX interpreter is not configured' }
    const readiness = {
      ready: true, reason: null, versions: {}, defaultBackend: 'cpu',
      backends: {
        cpu: { ...available, learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
        mlx: { ...disabled, learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
        rlx: { ...disabled, learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
      },
      capabilities: { train: available, simulate: available, evaluate: available, deploy: disabled },
    }
    const reply = { operation: 'readiness', readiness }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    for (const replacement of [
      { defaultBackend: 'mlx' }, { backends: undefined },
      { backends: { ...readiness.backends, mlx: { ...readiness.backends.mlx, learnerDevice: 'cpu' } } },
      { backends: { ...readiness.backends, mlx: { ...readiness.backends.mlx, physicsDevice: 'metal' } } },
      { backends: { ...readiness.backends, cpu: { ...readiness.backends.cpu, available: 'true' } } },
    ]) {
      expect(() => parseReply(JSON.stringify({ ...reply, readiness: { ...readiness, ...replacement } }))).toThrow()
    }
  })
  it.each(['cpu', 'mlx'])('preserves explicit v3 %s learner provenance and helper hashes', (backend) => {
    const run = runFixture()
    run.spec.backend = run.provenance.trainer.backend = backend
    run.provenance.trainer.learnerDevice = run.provenance.environment.updateDevice = backend === 'mlx' ? 'metal' : 'cpu'
    if (backend === 'cpu') Reflect.deleteProperty(run.provenance.trainer.helperSha256, 'mlx_ppo.py')
    const reply = { operation: 'run', run }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
  })
  it.each([
    ['omitted backend', (run: ReturnType<typeof runFixture>) => { Reflect.deleteProperty(run.spec, 'backend') }],
    ['unknown backend', (run: ReturnType<typeof runFixture>) => { run.spec.backend = 'auto' }],
    ['different trainer backend', (run: ReturnType<typeof runFixture>) => { run.provenance.trainer.backend = 'cpu' }],
    ['CPU learner for MLX', (run: ReturnType<typeof runFixture>) => { run.provenance.trainer.learnerDevice = 'cpu' }],
    ['GPU physics', (run: ReturnType<typeof runFixture>) => { run.provenance.trainer.physicsDevice = 'metal' }],
    ['different environment device', (run: ReturnType<typeof runFixture>) => { run.provenance.environment.updateDevice = 'cpu' }],
    ['missing trainer', (run: ReturnType<typeof runFixture>) => { Reflect.deleteProperty(run.provenance, 'trainer') }],
    ['missing helper hashes', (run: ReturnType<typeof runFixture>) => { Reflect.deleteProperty(run.provenance.trainer, 'helperSha256') }],
    ['empty MLX helpers', (run: ReturnType<typeof runFixture>) => { Reflect.deleteProperty(run.provenance.trainer.helperSha256, 'mlx_ppo.py') }],
    ['unrecorded helper name', (run: ReturnType<typeof runFixture>) => { Reflect.set(run.provenance.trainer.helperSha256, 'other.py', '2'.repeat(64)) }],
    ['MLX helpers on CPU', (run: ReturnType<typeof runFixture>) => {
      run.spec.backend = run.provenance.trainer.backend = 'cpu'
      run.provenance.trainer.learnerDevice = run.provenance.environment.updateDevice = 'cpu'
    }],
    ['malformed helper hash', (run: ReturnType<typeof runFixture>) => { run.provenance.trainer.helperSha256['mlx_ppo.py'] = 'not-a-sha256' }],
    ['malformed trainer hash', (run: ReturnType<typeof runFixture>) => { run.provenance.trainer.sha256 = 'not-a-sha256' }],
    ['missing recipe', (run: ReturnType<typeof runFixture>) => { Reflect.deleteProperty(run.provenance.trainer, 'recipe') }],
  ] as const)('rejects v3 provenance with %s', (_label, mutate) => {
    const run = runFixture()
    mutate(run)
    expect(() => parseReply(JSON.stringify({ operation: 'run', run }))).toThrow()
  })
  it.each([2, 4, null])('rejects unsupported run format %s instead of interpreting its metadata', (formatVersion) => {
    const run = { ...runFixture(), formatVersion }
    expect(() => parseReply(JSON.stringify({ operation: 'run', run }))).toThrow('Unsupported')
    expect(() => parseReply(JSON.stringify({ operation: 'runs', runs: [run], incompatibleRuns: [] }))).toThrow('Unsupported')
  })
  it('lists unsupported formats separately while preserving supported run provenance', () => {
    const incompatibleRuns = [
      { id: 'run-00000000-0000-0000-0000-000000000001', formatVersion: 2, reason: 'unsupported Robot Lab run format; only version 3 is supported' },
      { id: 'run-00000000-0000-0000-0000-000000000002', formatVersion: null, reason: 'unsupported Robot Lab run format; only version 3 is supported' },
    ]
    const reply = { operation: 'runs', runs: [runFixture()], incompatibleRuns }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    for (const replacement of [undefined, null, {}, [{ ...incompatibleRuns[0], reason: 123 }], [{ ...incompatibleRuns[0], formatVersion: '2' }], [{ ...incompatibleRuns[0], formatVersion: 3 }], [{ ...incompatibleRuns[0], formatVersion: 2.5 }], [{ ...incompatibleRuns[0], id: null }]]) {
      expect(() => parseReply(JSON.stringify({ ...reply, incompatibleRuns: replacement }))).toThrow()
    }
  })
  it('preserves scene mesh and geometry vectors and rejects malformed geometry', () => {
    const scene = { bodies: ['root'], jointNames: Array.from({ length: 14 }, (_, index) => `joint-${index}`),
      defaultJoints: Array<number>(14).fill(0), meshes: [{ v: [0, 0, 0], f: [0, 0, 0] }],
      geoms: [{ mesh: 0, body: 0, pos: [0, 0, 0], quat: [1, 0, 0, 0], mat: 'body', rgba: [1, 1, 1, 1] }] }
    expect(parseReply(JSON.stringify({ operation: 'scene', scene }))).toEqual({ operation: 'scene', scene })
    scene.geoms[0]!.quat = [1, 0, 0]
    expect(() => parseReply(JSON.stringify({ operation: 'scene', scene }))).toThrow('vector width')
  })
  it('rejects hardware permission even in an otherwise valid prepare reply', () => {
    const reply = { operation: 'prepare', policyId: 'shipped:alpha_stand', reasons: ['Simulation only'], allowed: false }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    expect(() => parseReply(JSON.stringify({ ...reply, allowed: true }))).toThrow('never authorize physical deployment')
  })
  it('retains recorded failures but refuses unknown run state and observation semantics', () => {
    const run = { ...runFixture(), state: 'failed', error: 'Export failed' }
    expect(parseReply(JSON.stringify({ operation: 'run', run }))).toEqual({ operation: 'run', run })
    expect(() => parseReply(JSON.stringify({ operation: 'run', run: { ...run, state: 'successful' } }))).toThrow('invalid run state')
    expect(() => parseReply(JSON.stringify({ operation: 'run', run: { ...run, observationProfile: 'unknown-61' } }))).toThrow('unknown observation semantics')
  })
  it('accepts shipped policy records and refuses unsupported verification or hardware deployment', () => {
    const policy = { id: 'shipped:alpha_stand', name: 'Stand', sha256: 'a'.repeat(64), observationProfile: 'microduck-standard-61',
      runId: null, verification: 'unverified', runtimeCompatibility: { available: true, reason: null },
      deployment: { available: false, reason: 'Simulation only' } }
    expect(parseReply(JSON.stringify({ operation: 'policies', policies: [policy] }))).toEqual({ operation: 'policies', policies: [policy] })
    expect(() => parseReply(JSON.stringify({ operation: 'policies', policies: [{ ...policy, verification: 'approved' }] }))).toThrow('verification')
    expect(() => parseReply(JSON.stringify({ operation: 'policies', policies: [{ ...policy, deployment: { available: true, reason: null } }] }))).toThrow('authorize deployment')
  })
  it('preserves unavailable readiness and refuses deploy capability on a valid readiness record', () => {
    const unavailable = { available: false, reason: 'Interpreter unavailable' }
    const readiness = { ready: false, reason: 'Interpreter unavailable', versions: {}, defaultBackend: 'cpu',
      backends: Object.fromEntries(['cpu', 'mlx', 'rlx'].map(backend => [backend, { ...unavailable,
        learnerDevice: backend === 'cpu' ? 'cpu' : 'metal', physicsDevice: 'cpu', versions: {} }])),
      capabilities: { train: unavailable, simulate: unavailable, evaluate: unavailable, deploy: unavailable } }
    expect(parseReply(JSON.stringify({ operation: 'readiness', readiness }))).toEqual({ operation: 'readiness', readiness })
    readiness.capabilities.deploy = { available: true, reason: 'Hardware approved' }
    expect(() => parseReply(JSON.stringify({ operation: 'readiness', readiness }))).toThrow('hardware deployment')
  })
  it('retains null pose error in a balance-only evaluation reply', () => {
    const run = runFixture()
    const evaluation = { id: 'eval-00000000-0000-0000-0000-000000000000', createdAt: run.createdAt,
      evaluatedAt: run.finishedAt, policyId: run.policyId, policyHash: run.policySha256,
      observationProfile: run.observationProfile, passed: true, limitations: ['Simulation only'],
      spec: { policyId: run.policyId, episodes: 1, stepsPerEpisode: 100, seed: 1, maxTerminations: 0, minMeanUprightFraction: 0.9 },
      physics: { actuator: 'bam', observationNoise: false, actionDelay: true, domainRandomization: false,
        randomYaw: false, bam: run.provenance.bam },
      episodes: [{ seed: 1, steps: 100, reward: 0, uprightFraction: 1, terminated: false, poseRmse: null, bamSettings: {} }] }
    expect(parseReply(JSON.stringify({ operation: 'evaluate', evaluation }))).toEqual({ operation: 'evaluate', evaluation })
  })
  it('preserves empty collections with required incompatibility diagnostics', () => {
    expect(parseReply('{"operation":"runs","runs":[],"incompatibleRuns":[]}')).toEqual({ operation: 'runs', runs: [], incompatibleRuns: [] })
  })
})
