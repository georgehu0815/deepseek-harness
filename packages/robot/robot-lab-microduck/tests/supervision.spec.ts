import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { RobotReadiness, RobotRun, RobotTrainingRequest, RobotTrainingSpec } from '@deepseek-ai/dsh-robot-lab'
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
  },
  capabilities: {
    train: { available: true, reason: null }, simulate: { available: true, reason: null },
    evaluate: { available: true, reason: null }, deploy: { available: false, reason: 'Simulation only' },
  },
}

function harness(options: { mlxPythonBin?: string; mlxFailure?: boolean } = {}) {
  let stored: RobotRun
  let settledSidecar: Pick<RobotRun, 'state' | 'error' | 'finishedAt'> | undefined
  let terminations = 0
  let trainingSignal: AbortSignal | undefined
  const exiting = deferred<SubprocessOutcome>()
  const treeExited = deferred<boolean>()
  const waitStarted = deferred<boolean>()
  const writes: RobotRun[] = []
  const spawned: Array<{
    python: string | undefined
    operation: string
    backend?: string | undefined
    spec?: RobotTrainingSpec | undefined
  }> = []
  const context = {
    fs: { resolve: async (path: string) => path, processPath: (path: string) => path, contains: () => true,
      stat: async (target: string) => (String(target).endsWith('state.json') ? settledSidecar : stored) === undefined ? undefined : {},
      readText: async (target: string) => JSON.stringify(String(target).endsWith('state.json') ? settledSidecar : stored),
      writeText: async (target: unknown, text: string) => {
        const parsed = JSON.parse(text) as RobotRun
        if (String(target).endsWith('state.json')) settledSidecar = parsed as Pick<RobotRun, 'state' | 'error' | 'finishedAt'>
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
        if (spec.argv[0] === options.mlxPythonBin && options.mlxFailure) throw new Error('Metal is unavailable in the configured interpreter')
        let reply: unknown
        if (payload.request.operation === 'readiness') reply = { operation: 'readiness', readiness: structuredClone(readiness) }
        else if (payload.request.operation === 'prepare_train') {
          const backend = payload.request.spec.backend
          const learnerDevice = backend === 'mlx' ? 'metal' : 'cpu'
          stored = { formatVersion: 3, id: payload.request.runId, state: 'starting', createdAt: '2026-09-04T00:00:00Z', finishedAt: null,
            spec: payload.request.spec, recipeHash: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), progress: null, error: null, policyId: null, policySha256: null,
            observationProfile: 'microduck-standard-61', provenance: { bridgeSha256: 'c'.repeat(64), dependencyVersions: {},
              trainer: { backend, learnerDevice, physicsDevice: 'cpu', pythonVersion: '3.12.7', platform: 'Darwin', architecture: 'arm64', hardware: 'fixture',
                dependencyVersions: {}, helperSha256: backend === 'mlx' ? { 'mlx_ppo.py': 'd'.repeat(64) } : {}, recipe: {}, sha256: 'e'.repeat(64) },
              bam: { source: 'fixture', parameters: { kt: 0.36 }, sha256: 'f'.repeat(64) },
              environment: { domainRandomization: false, randomYaw: false, standingSpawns: true, assistance: false,
                updateDevice: learnerDevice, observationNoise: true, actionDelay: true } } }
          reply = { operation: 'train', run: stored }
        } else if (payload.request.operation === 'run') reply = { operation: 'run', run: { ...stored, ...(settledSidecar ?? {}) } }
        else if (payload.request.operation !== 'train') throw new Error('Unexpected bridge operation')
        const active = payload.request.operation === 'train'
        const handle: SubprocessHandle = {
          pid: 123, stdin: undefined, stdout: undefined, stderr: undefined,
          collected: { stdout: { readFrom: () => ({ text: JSON.stringify(reply), nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
          done: active ? exiting.promise : Promise.resolve({ exitCode: 0, signal: null }),
          terminate: () => {
            if (active) { terminations += 1; exiting.resolve({ exitCode: null, signal: 'SIGTERM' }) }
          },
          waitForExit: async () => { if (!active) return true; waitStarted.resolve(true); return treeExited.promise },
        }
        spec.signal?.addEventListener('abort', () => { handle.terminate() }, { once: true })
        if (active) trainingSignal = spec.signal
        return handle
      },
    },
  } as unknown as Context
  const provider = new MicroduckProvider(context, Config({ sourceRoot: '/installed/lab', pythonBin: '/installed/python',
    ...(options.mlxPythonBin === undefined ? {} : { mlxPythonBin: options.mlxPythonBin }) }))
  return { provider, waitStarted, treeExited, writes, spawned, terminations: () => terminations, trainingSignal: () => trainingSignal! }
}

describe('MicroDuck process ownership', () => {
  it.each([undefined, 'cpu', 'mlx'] as const)('dispatches backend %s explicitly through preparation and training', async (backend) => {
    const h = harness({ mlxPythonBin: '/installed/mlx-python' })
    const owner = Session.create(SessionId('backend-owner'))
    try {
      const spec = backend === undefined ? training : { ...training, backend }
      const admitted = await h.provider.execute(owner, { operation: 'train', spec }, new AbortController().signal)
      const selected = backend ?? 'cpu'
      const python = selected === 'mlx' ? '/installed/mlx-python' : '/installed/python'
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
  it('rejects explicit MLX without a configured interpreter rather than starting CPU', async () => {
    const h = harness()
    try {
      await expect(h.provider.execute(Session.create(SessionId('missing-mlx')), {
        operation: 'train', spec: { ...training, backend: 'mlx' },
      }, new AbortController().signal)).rejects.toThrow('configure mlxPythonBin; no CPU fallback')
      expect(h.spawned).toEqual([])
      expect(h.writes).toEqual([])
    } finally { await h.provider.dispose() }
  })
  it('does not retry failed MLX preparation with the CPU interpreter', async () => {
    const h = harness({ mlxPythonBin: '/installed/mlx-python', mlxFailure: true })
    try {
      await expect(h.provider.execute(Session.create(SessionId('broken-mlx')), {
        operation: 'train', spec: { ...training, backend: 'mlx' },
      }, new AbortController().signal)).rejects.toThrow('Metal is unavailable')
      expect(h.spawned).toEqual([{ python: '/installed/mlx-python', operation: 'prepare_train', backend: undefined, spec: { ...training, backend: 'mlx' } }])
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
