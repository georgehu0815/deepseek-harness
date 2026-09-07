import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { RobotPolicyId, RobotReadiness, RobotRun, RobotTrainingRequest, RobotTrainingSpec } from '@deepseek-ai/dsh-robot-lab'
import { describe, expect, it, vi } from 'vitest'
import { Config, MicroduckProvider } from '../src/index.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const training: RobotTrainingRequest = { name: 'Test', behaviorId: 'stand', steps: 256, envs: 1, seed: 0, actuator: 'bam', weights: {}, clip: null }
const readiness: RobotReadiness = {
  ready: true, reason: null, versions: {}, defaultBackend: 'cpu',
  backends: {
    cpu: { available: true, reason: null, learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
    mlx: { available: false, reason: 'MLX is not configured', learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
    rlx: { available: false, reason: 'RLX is not configured', learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
  },
  capabilities: {
    train: { available: true, reason: null }, simulate: { available: true, reason: null },
    evaluate: { available: true, reason: null }, deploy: { available: false, reason: 'Simulation only' },
  },
}

function harness(options: {
  mlxPythonBin?: string
  mlxFailure?: boolean
  rlxPythonBin?: string
  rlxFailure?: boolean
  holdRead?: 'run' | 'runs'
  reportedProgress?: unknown
} = {}) {
  let stored: RobotRun
  let settledSidecar: Pick<RobotRun, 'state' | 'error' | 'finishedAt'> | undefined
  let terminations = 0
  let trainingSignal: AbortSignal | undefined
  const exiting = deferred<SubprocessOutcome>()
  const treeExited = deferred<boolean>()
  const waitStarted = deferred<boolean>()
  const readStarted = deferred<boolean>()
  const readReleased = deferred<boolean>()
  let readHeld = false
  const writes: RobotRun[] = []
  const spawned: Array<{
    python: string | undefined
    operation: string
    backend?: string | undefined
    spec?: RobotTrainingSpec | undefined
  }> = []
  const context = {
    fs: { resolve: async (path: string) => path, processPath: (path: string) => path, contains: () => true,
      stat: async (target: string) => (target.endsWith('state.json') ? settledSidecar : stored) === undefined ? undefined : {},
      readText: async (target: string) => JSON.stringify(target.endsWith('state.json') ? settledSidecar : stored),
      writeText: async (target: unknown, text: string) => {
        const parsed = JSON.parse(text) as RobotRun
        if (String(target).endsWith('state.json')) settledSidecar = parsed
        else stored = parsed
        writes.push(parsed)
      },
    },
    sandboxPolicy: { resolve: ({ session }: { session: Session }) => ({ mode: 'workspace-write', workspaceRoot: '/owned', sessionId: session.id }) },
    sandbox: { confine: (argv: string[]) => ({ argv, enforcement: 'full' }) },
    logger: { error: vi.fn() },
    subprocess: {
      resolveExecutable: async (path: string) => path,
      spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
        if (typeof spec.stdio.stdin === 'string') throw new Error('Expected JSON stdin')
        const payload = JSON.parse(spec.stdio.stdin.data) as { request: { operation: string; runId: RobotRun['id']; backend?: string; spec: RobotTrainingSpec } }
        spawned.push({ python: spec.argv[0], operation: payload.request.operation,
          backend: payload.request.backend, spec: payload.request.spec })
        if ((spec.argv[0] === options.mlxPythonBin && options.mlxFailure) || (spec.argv[0] === options.rlxPythonBin && options.rlxFailure)) throw new Error('Metal is unavailable in the configured interpreter')
        let reply: unknown
        if (payload.request.operation === 'readiness') reply = { operation: 'readiness', readiness: structuredClone(readiness) }
        else if (payload.request.operation === 'prepare_train') {
          const backend = payload.request.spec.backend
          const learnerDevice = backend === 'cpu' ? 'cpu' : 'metal'
          stored = { formatVersion: 3, id: payload.request.runId, state: 'starting', createdAt: '2026-09-04T00:00:00Z', finishedAt: null,
            spec: payload.request.spec, recipeHash: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), progress: null, error: null, policyId: null, policySha256: null,
            observationProfile: 'microduck-standard-61', provenance: { bridgeSha256: 'c'.repeat(64), dependencyVersions: {},
              trainer: { backend, learnerDevice, physicsDevice: 'cpu', pythonVersion: '3.12.7', platform: 'Darwin', architecture: 'arm64', hardware: 'fixture',
                dependencyVersions: {}, helperSha256: backend === 'cpu' ? {} : { [backend === 'rlx' ? 'rlx_ppo.py' : 'mlx_ppo.py']: 'd'.repeat(64) }, recipe: {}, sha256: 'e'.repeat(64) },
              bam: { source: 'fixture', parameters: { kt: 0.36 }, sha256: 'f'.repeat(64) },
              environment: { domainRandomization: false, randomYaw: false, standingSpawns: true, assistance: false,
                updateDevice: learnerDevice, observationNoise: true, actionDelay: true } } }
          reply = { operation: 'train', run: stored }
        } else if (payload.request.operation === 'run' || payload.request.operation === 'runs') {
          const run = { ...stored, ...(settledSidecar ?? {}),
            progress: options.reportedProgress === undefined ? stored.progress : options.reportedProgress }
          reply = payload.request.operation === 'run' ? { operation: 'run', run } : { operation: 'runs', runs: [run], incompatibleRuns: [] }
        } else if (payload.request.operation !== 'train') throw new Error('Unexpected bridge operation')
        const active = payload.request.operation === 'train'
        if (active) stored = { ...stored, state: 'running' }
        const hold = !readHeld && payload.request.operation === options.holdRead
        if (hold) readHeld = true
        const handle: SubprocessHandle = {
          pid: 123, stdin: undefined, stdout: undefined, stderr: undefined,
          collected: { stdout: { readFrom: () => ({ text: JSON.stringify(reply), nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
          done: active ? exiting.promise : Promise.resolve({ exitCode: 0, signal: null }),
          terminate: () => {
            if (active) { terminations += 1; exiting.resolve({ exitCode: null, signal: 'SIGTERM' }) }
          },
          waitForExit: async () => {
            if (hold) { readStarted.resolve(true); return readReleased.promise }
            if (!active) return true
            waitStarted.resolve(true); return treeExited.promise
          },
        }
        spec.signal?.addEventListener('abort', () => { handle.terminate() }, { once: true })
        if (active) trainingSignal = spec.signal
        return handle
      },
    },
  } as unknown as Context
  const provider = new MicroduckProvider(context, Config({ sourceRoot: '/installed/lab', pythonBin: '/installed/python',
    ...(options.mlxPythonBin === undefined ? {} : { mlxPythonBin: options.mlxPythonBin }),
    ...(options.rlxPythonBin === undefined ? {} : { rlxPythonBin: options.rlxPythonBin, rlxSourceRoot: '/installed/rlx' }) }))
  const commitCompletion = () => {
    stored = { ...stored, state: 'completed', finishedAt: '2026-09-04T00:00:01Z',
      policyId: `run:${stored.id}` as RobotPolicyId, policySha256: '1'.repeat(64),
      ...(stored.spec.backend === 'rlx' ? { artifactSha256: { 'rlx-artifacts.json': '2'.repeat(64) } } : {}) }
    return stored
  }
  return { provider, waitStarted, treeExited, readStarted, readReleased, writes, spawned, commitCompletion,
    terminations: () => terminations, trainingSignal: () => trainingSignal! }
}

describe('MicroDuck process ownership', () => {
  it.each([undefined, 'cpu', 'mlx', 'rlx'] as const)('dispatches backend %s explicitly through preparation and training', async (backend) => {
    const h = harness({ mlxPythonBin: '/installed/mlx-python', rlxPythonBin: '/installed/rlx-python' })
    const owner = Session.create(SessionId('backend-owner'))
    try {
      const spec = backend === undefined ? training : { ...training, backend }
      const admitted = await h.provider.execute(owner, { operation: 'train', spec }, new AbortController().signal)
      const selected = backend ?? 'cpu'
      const python = selected === 'cpu' ? '/installed/python' : `/installed/${selected}-python`
      expect(admitted).toMatchObject({ operation: 'train', run: { spec: { ...training, backend: selected } } })
      expect(h.spawned).toEqual([
        { python, operation: 'prepare_train', backend: undefined, spec: { ...training, backend: selected } },
        { python, operation: 'train', backend: undefined, spec: undefined },
      ])
      expect(training).not.toHaveProperty('backend')
    } finally {
      h.treeExited.resolve(true)
      await h.provider.dispose()
    }
  })
  it.each(['mlx', 'rlx'] as const)('rejects explicit %s without a configured interpreter rather than starting CPU', async (backend) => {
    const h = harness()
    try {
      await expect(h.provider.execute(Session.create(SessionId(`missing-${backend}`)), {
        operation: 'train', spec: { ...training, backend },
      }, new AbortController().signal)).rejects.toThrow('no CPU fallback')
      expect(h.spawned).toEqual([])
      expect(h.writes).toEqual([])
    } finally { await h.provider.dispose() }
  })
  it.each(['mlx', 'rlx'] as const)('does not retry failed %s preparation with the CPU interpreter', async (backend) => {
    const python = `/installed/${backend}-python`
    const h = harness({ [`${backend}PythonBin`]: python, [`${backend}Failure`]: true })
    try {
      await expect(h.provider.execute(Session.create(SessionId(`broken-${backend}`)), {
        operation: 'train', spec: { ...training, backend },
      }, new AbortController().signal)).rejects.toThrow('Metal is unavailable')
      expect(h.spawned).toEqual([{ python, operation: 'prepare_train', backend: undefined, spec: { ...training, backend } }])
      expect(h.writes).toEqual([])
    } finally { await h.provider.dispose() }
  })
  it('retains CPU training and simulation readiness when the optional MLX probe fails', async () => {
    const h = harness({ mlxPythonBin: '/installed/mlx-python', mlxFailure: true })
    try {
      const result = await h.provider.execute(Session.create(SessionId('optional-mlx')), { operation: 'readiness' }, new AbortController().signal)
      expect(result).toMatchObject({ operation: 'readiness', readiness: {
        ready: true, reason: null, defaultBackend: 'cpu',
        backends: { cpu: readiness.backends.cpu, mlx: { available: false, learnerDevice: 'metal', physicsDevice: 'cpu' } },
        capabilities: readiness.capabilities,
      } })
      if (result.operation !== 'readiness') throw new Error('Expected readiness')
      expect(result.readiness.backends.mlx.reason).toContain('Metal is unavailable')
      expect(h.spawned).toEqual([
        { python: '/installed/python', operation: 'readiness', backend: undefined, spec: undefined },
        { python: '/installed/mlx-python', operation: 'readiness', backend: 'mlx', spec: undefined },
      ])
      const admitted = await h.provider.execute(Session.create(SessionId('cpu-after-mlx-probe')), { operation: 'train', spec: training }, new AbortController().signal)
      expect(admitted).toMatchObject({ operation: 'train', run: { spec: { backend: 'cpu' } } })
      expect(h.spawned.slice(2).map(call => [call.python, call.operation])).toEqual([
        ['/installed/python', 'prepare_train'], ['/installed/python', 'train'],
      ])
    } finally { h.treeExited.resolve(true); await h.provider.dispose() }
  })
  it('retains admitted training after caller cancellation and waits for the whole tree on stop', async () => {
    const h = harness()
    const owner = Session.create(SessionId('owner'))
    const caller = new AbortController()
    const admitted = await h.provider.execute(owner, { operation: 'train', spec: training }, caller.signal)
    expect(admitted.operation).toBe('train')
    if (admitted.operation !== 'train') throw new Error('Expected training')
    caller.abort()
    expect(h.trainingSignal().aborted).toBe(false)
    await expect(h.provider.execute(owner, { operation: 'train', spec: training }, new AbortController().signal)).rejects.toThrow('capacity')
    const foreign = Session.create(SessionId('foreign'))
    await expect(h.provider.execute(foreign, { operation: 'stop', runId: admitted.run.id }, new AbortController().signal)).rejects.toThrow('another session')
    let finished = false
    const stopped = h.provider.execute(owner, { operation: 'stop', runId: admitted.run.id }, new AbortController().signal).then((result) => { finished = true; return result })
    await h.waitStarted.promise
    expect(finished).toBe(false)
    expect(h.terminations()).toBe(1)
    h.treeExited.resolve(true)
    expect(await stopped).toMatchObject({ operation: 'stop', run: { state: 'stopped' } })
    expect(h.writes.at(-1)?.state).toBe('stopped')
    await h.provider.dispose()
  })
  it.each(['cpu', 'mlx', 'rlx'] as const)('preserves a committed %s policy when Stop races with process exit', async (backend) => {
    const h = harness({ mlxPythonBin: '/installed/mlx-python', rlxPythonBin: '/installed/rlx-python' })
    const owner = Session.create(SessionId(`committed-${backend}`))
    try {
      const admitted = await h.provider.execute(owner, { operation: 'train', spec: { ...training, backend } }, new AbortController().signal)
      if (admitted.operation !== 'train') throw new Error('Expected training')
      const completed = h.commitCompletion()
      const stopping = h.provider.execute(owner, { operation: 'stop', runId: admitted.run.id }, new AbortController().signal)
      await h.waitStarted.promise
      expect(h.writes).toEqual([])
      h.treeExited.resolve(true)
      expect(await stopping).toMatchObject({ operation: 'stop', run: completed })
      expect(h.writes).toEqual([])
    } finally {
      h.treeExited.resolve(true)
      await h.provider.dispose()
    }
  })
  it.each((['cpu', 'mlx', 'rlx'] as const).flatMap(backend => (['run', 'runs'] as const).flatMap(operation =>
    (backend === 'rlx' ? [false, true] : [false]).map(telemetry => ({ backend, operation, telemetry })))))(
    'retains observed progress when $backend $operation collection overlaps committed completion and owner release (RLX telemetry: $telemetry)', async ({ backend, operation, telemetry }) => {
      const progress: NonNullable<RobotRun['progress']> = { steps: 128, total: training.steps, elapsedSeconds: 1, reward: 0.5,
        ...(telemetry ? { rlx: { version: 1, completedRollouts: 1, optimizerSteps: 4, lastMeanLoss: -0.25,
          collectionSeconds: 0.6, updateSeconds: 0.4, checkpointSeconds: null, exportSeconds: null } } : {}) }
      const h = harness({ mlxPythonBin: '/installed/mlx-python', rlxPythonBin: '/installed/rlx-python',
        holdRead: operation, reportedProgress: progress })
      const owner = Session.create(SessionId(`progress-${backend}-${operation}`))
      try {
        const admitted = await h.provider.execute(owner, { operation: 'train', spec: { ...training, backend } }, new AbortController().signal)
        if (admitted.operation !== 'train') throw new Error('Expected training')
        const reading = h.provider.execute(owner, operation === 'run' ? { operation, runId: admitted.run.id } : { operation }, new AbortController().signal)
        await h.readStarted.promise
        const completed = h.commitCompletion()
        const stopping = h.provider.execute(owner, { operation: 'stop', runId: admitted.run.id }, new AbortController().signal)
        await h.waitStarted.promise
        h.treeExited.resolve(true)
        await stopping
        h.readReleased.resolve(true)
        const result = await reading
        const run = result.operation === 'run' ? result.run : result.operation === 'runs' ? result.runs[0] : undefined
        expect(run).toEqual({ ...completed, progress })
        expect(h.writes).toEqual([])
      } finally {
        h.readReleased.resolve(true); h.treeExited.resolve(true)
        await h.provider.dispose()
      }
    },
  )
  it.each(['run', 'runs'] as const)('refuses malformed RLX telemetry from %s process JSON without publishing it', async (operation) => {
    const h = harness({ rlxPythonBin: '/installed/rlx-python', reportedProgress: {
      steps: 128, total: training.steps, elapsedSeconds: 1, reward: null,
      rlx: { version: 2, completedRollouts: 1, optimizerSteps: 4, lastMeanLoss: 0,
        collectionSeconds: 0.6, updateSeconds: 0.4, checkpointSeconds: null, exportSeconds: null },
    } })
    const owner = Session.create(SessionId(`invalid-progress-${operation}`))
    try {
      const admitted = await h.provider.execute(owner, { operation: 'train', spec: { ...training, backend: 'rlx' } }, new AbortController().signal)
      if (admitted.operation !== 'train') throw new Error('Expected training')
      await expect(h.provider.execute(owner, operation === 'run' ? { operation, runId: admitted.run.id } : { operation },
        new AbortController().signal)).rejects.toThrow('Unexpected RLX progress fields or version')
      expect(h.writes).toEqual([])
    } finally { h.treeExited.resolve(true); await h.provider.dispose() }
  })
  it('provider disposal cancels owned training and rejects subsequent work', async () => {
    const h = harness()
    const owner = Session.create(SessionId('owner'))
    await h.provider.execute(owner, { operation: 'train', spec: training }, new AbortController().signal)
    const disposing = h.provider.dispose()
    await h.waitStarted.promise
    expect(h.terminations()).toBe(1)
    h.treeExited.resolve(true)
    await disposing
    expect(h.writes.at(-1)?.state).toBe('stopped')
    await expect(h.provider.execute(owner, { operation: 'readiness' }, new AbortController().signal)).rejects.toThrow('disposed')
  })
})
