import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RobotProjectRecipe } from '@deepseek-ai/dsh-robot-lab'
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

describe('MicroDuck provider admission', () => {
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
  it('preserves empty collections with required incompatibility diagnostics', () => {
    expect(parseReply('{"operation":"runs","runs":[],"incompatibleRuns":[]}')).toEqual({ operation: 'runs', runs: [], incompatibleRuns: [] })
  })
})
