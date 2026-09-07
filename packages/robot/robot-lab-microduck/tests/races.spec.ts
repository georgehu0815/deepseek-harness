import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { RobotRun, RobotTrainingRequest, RobotTrainingSpec } from '@deepseek-ai/dsh-robot-lab'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { Config, MicroduckProvider } from '../src/index.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const owner = Session.create(SessionId('race-owner'))
const signal = () => new AbortController().signal
const training: RobotTrainingRequest = { name: 'Race', behaviorId: 'stand', steps: 256, envs: 1, seed: 0, actuator: 'bam', weights: {}, clip: null }

function harness() {
  let stored: RobotRun | undefined
  let settledSidecar: Pick<RobotRun, 'state' | 'error' | 'finishedAt'> | undefined
  const spawned: string[] = []
  const trainingExit = deferred<SubprocessOutcome>()
  const treeExit = deferred<boolean>()
  const writing = deferred<undefined>()
  const writes: RobotRun[] = []
  const hooks = {
    afterSpawn: (_operation: string) => {},
    beforeResolve: async () => {},
    beforePrepareExit: async () => {},
    beforeQueryExit: async () => {},
    beforeWrite: async () => {},
    readSnapshot: () => stored,
  }
  const ctx = {
    fs: {
      resolve: async (path: string) => path, processPath: (path: string) => path, contains: () => true,
      stat: async (target: string) => (target.endsWith('state.json') ? settledSidecar : stored) === undefined ? undefined : {},
      readText: async (target: string) => JSON.stringify(target.endsWith('state.json') ? settledSidecar : hooks.readSnapshot()),
      writeText: async (target: unknown, text: string) => {
        writing.resolve(undefined); await hooks.beforeWrite()
        const parsed = JSON.parse(text) as RobotRun
        if (String(target).endsWith('state.json')) settledSidecar = parsed
        else stored = parsed
        writes.push(parsed)
      },
    },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/owned' }) },
    sandbox: { confine: (argv: string[]) => ({ argv, enforcement: 'full' }) },
    logger: { error: vi.fn() },
    subprocess: {
      resolveExecutable: async (path: string) => { await hooks.beforeResolve(); return path },
      spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
        if (typeof spec.stdio.stdin === 'string') throw new Error('Expected JSON stdin')
        const request = (JSON.parse(spec.stdio.stdin.data) as { request: { operation: string; runId: RobotRun['id']; spec: RobotTrainingSpec } }).request
        spawned.push(request.operation)
        if (request.operation === 'prepare_train') {
          stored = { formatVersion: 3, id: request.runId, state: 'starting', createdAt: '2026-09-04T00:00:00Z', finishedAt: null,
            spec: request.spec, recipeHash: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64), progress: null, error: null, policyId: null, policySha256: null,
            observationProfile: 'microduck-standard-61', provenance: { bridgeSha256: 'c'.repeat(64), dependencyVersions: {},
              trainer: { backend: 'cpu', learnerDevice: 'cpu', physicsDevice: 'cpu', pythonVersion: '3.12.7', platform: 'Darwin', architecture: 'arm64', hardware: 'fixture',
                dependencyVersions: {}, helperSha256: {}, recipe: {}, sha256: 'd'.repeat(64) },
              bam: { source: 'fixture', parameters: { kt: 0.36 }, sha256: 'e'.repeat(64) },
              environment: { domainRandomization: false, randomYaw: false, standingSpawns: true, assistance: false, updateDevice: 'cpu', observationNoise: true, actionDelay: true } } }
        }
        const snapshot = structuredClone(stored)
        const active = request.operation === 'train'
        const terminate = () => { if (active) trainingExit.resolve({ exitCode: null, signal: 'SIGTERM' }) }
        spec.signal?.addEventListener('abort', terminate, { once: true })
        const done = active ? trainingExit.promise : (request.operation === 'prepare_train' ? hooks.beforePrepareExit() : hooks.beforeQueryExit()).then(() => ({ exitCode: 0, signal: null }))
        const handle: SubprocessHandle = {
          pid: 123, stdin: undefined, stdout: undefined, stderr: undefined, done, terminate,
          waitForExit: async () => active ? treeExit.promise : true,
          collected: { stdout: { readFrom: () => ({ text: JSON.stringify({ operation: request.operation === 'prepare_train' ? 'train' : request.operation, run: active ? stored : { ...snapshot, ...(settledSidecar ?? {}) } }), nextOffset: 0, lossy: false }) } },
        }
        hooks.afterSpawn(request.operation)
        return handle
      },
    },
  }
  const provider = new MicroduckProvider(ctx as unknown as Context, Config({ sourceRoot: '/installed/lab', pythonBin: '/installed/python' }))
  return { provider, hooks, spawned, writes, writing, treeExit, trainingExit,
    stored: () => { if (stored === undefined) throw new Error('No manifest'); return stored },
    settled: () => settledSidecar,
    update: (value: Partial<Pick<RobotRun, 'state' | 'policySha256' | 'finishedAt'>>) => { if (stored === undefined) throw new Error('No manifest'); stored = { ...stored, ...value } },
  }
}

describe('MicroDuck lifecycle races', () => {
  it('preserves a completed manifest when an older running query arrives', async () => {
    const h = harness()
    await h.provider.execute(owner, { operation: 'train', spec: training }, signal())
    expect(h.stored().spec).toEqual({ ...training, backend: 'cpu' })
    h.update({ state: 'running' })
    const queryExit = deferred<undefined>()
    const queried = deferred<undefined>()
    h.hooks.beforeQueryExit = () => { queried.resolve(undefined); return queryExit.promise }
    const query = h.provider.execute(owner, { operation: 'run', runId: h.stored().id }, signal())
    await queried.promise
    h.update({ state: 'completed', policySha256: 'a'.repeat(64), finishedAt: '2026-09-04T00:01:00Z' })
    h.trainingExit.resolve({ exitCode: 0, signal: null }); h.treeExit.resolve(true)
    // Drain the completion continuations before releasing the already-snapshotted query.
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    queryExit.resolve(undefined)
    expect(await query).toMatchObject({ run: { state: 'completed', finishedAt: '2026-09-04T00:01:00Z' } })
    expect(h.stored().state).toBe('completed')
    expect(h.writes).toHaveLength(0)
    await h.provider.dispose()
  })

  it('disposal at spawn publication waits for tree exit and manifest settlement', async () => {
    const h = harness()
    const writeExit = deferred<undefined>()
    h.hooks.beforeWrite = () => writeExit.promise
    let disposing: Promise<void> | undefined
    let disposed = false
    h.hooks.afterSpawn = (operation) => {
      if (operation === 'train') queueMicrotask(() => { disposing = h.provider.dispose().then(() => { disposed = true }) })
    }
    const admission = h.provider.execute(owner, { operation: 'train', spec: training }, signal()).catch(() => undefined)
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(disposed).toBe(false)
    h.treeExit.resolve(true)
    await h.writing.promise
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    const returnedBeforeWrite = disposed
    writeExit.resolve(undefined)
    await admission; await disposing
    expect(returnedBeforeWrite).toBe(false)
    expect(h.settled()?.state).toBe('stopped')
  })

  it('keeps a visible preparation owned while its response is pending', async () => {
    const h = harness()
    const prepareExit = deferred<undefined>()
    const prepared = deferred<undefined>()
    h.hooks.beforePrepareExit = () => { prepared.resolve(undefined); return prepareExit.promise }
    const admission = h.provider.execute(owner, { operation: 'train', spec: training }, signal())
    await prepared.promise
    const result = await h.provider.execute(owner, { operation: 'run', runId: h.stored().id }, signal())
    prepareExit.resolve(undefined); await admission
    h.treeExit.resolve(true); await h.provider.dispose()
    expect(result).toMatchObject({ run: { state: 'starting' } })
    expect(h.writes.some(run => run.state === 'interrupted')).toBe(false)
  })

  it('stops a preparing run without admitting a trainer and waits for persistence', async () => {
    const h = harness()
    const prepareExit = deferred<undefined>()
    const prepared = deferred<undefined>()
    const writeExit = deferred<undefined>()
    h.hooks.beforePrepareExit = () => { prepared.resolve(undefined); return prepareExit.promise }
    h.hooks.beforeWrite = () => writeExit.promise
    const admission = h.provider.execute(owner, { operation: 'train', spec: training }, signal())
    const rejected = expect(admission).rejects.toThrow('cancelled')
    await prepared.promise
    const stopped = h.provider.execute(owner, { operation: 'stop', runId: h.stored().id }, signal())
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    prepareExit.resolve(undefined)
    await h.writing.promise
    expect(h.spawned).not.toContain('train')
    writeExit.resolve(undefined)
    await rejected
    expect(await stopped).toMatchObject({ operation: 'stop', run: { state: 'stopped' } })
    await h.provider.dispose()
  })

  it('disposal drains executable resolution and rejects late process creation', async () => {
    const h = harness()
    const resolving = deferred<undefined>()
    const executable = deferred<undefined>()
    h.hooks.beforeResolve = () => { resolving.resolve(undefined); return executable.promise }
    const admission = h.provider.execute(owner, { operation: 'train', spec: training }, signal())
    const rejected = expect(admission).rejects.toThrow('cancelled')
    await resolving.promise
    let disposed = false
    const disposing = h.provider.dispose().then(() => { disposed = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(disposed).toBe(false)
    executable.resolve(undefined)
    await rejected; await disposing
    expect(h.spawned).toEqual([])
    await expect(h.provider.execute(owner, { operation: 'train', spec: training }, signal())).rejects.toThrow('disposed')
  })

  it('a rejected process outcome still waits for the whole tree before settling its manifest', async () => {
    const h = harness()
    await h.provider.execute(owner, { operation: 'train', spec: training }, signal())
    h.trainingExit.reject(new Error('process collection failed'))
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(h.writes).toHaveLength(0)
    h.treeExit.resolve(true)
    await h.writing.promise
    await h.provider.dispose()
    expect(h.settled()).toMatchObject({ state: 'failed', error: 'Error: process collection failed' })
  })

  it('disposal also waits for orphan reconciliation writes already in progress', async () => {
    const h = harness()
    await h.provider.execute(owner, { operation: 'train', spec: training }, signal())
    h.update({ state: 'completed', policySha256: 'a'.repeat(64) })
    h.trainingExit.resolve({ exitCode: 0, signal: null }); h.treeExit.resolve(true)
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    h.update({ state: 'running' })
    const writeExit = deferred<undefined>()
    h.hooks.beforeWrite = () => writeExit.promise
    const query = h.provider.execute(owner, { operation: 'run', runId: h.stored().id }, signal())
    await h.writing.promise
    let disposed = false
    const disposing = h.provider.dispose().then(() => { disposed = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(disposed).toBe(false)
    writeExit.resolve(undefined)
    await query; await disposing
    expect(h.settled()?.state).toBe('interrupted')
  })

  it('cancellation after manifest creation settles it without starting training', async () => {
    const h = harness()
    const prepareExit = deferred<undefined>()
    const prepared = deferred<undefined>()
    const caller = new AbortController()
    h.hooks.beforePrepareExit = () => { prepared.resolve(undefined); return prepareExit.promise }
    const admission = h.provider.execute(owner, { operation: 'train', spec: training }, caller.signal)
    const rejected = expect(admission).rejects.toThrow('cancelled')
    await prepared.promise
    caller.abort(); prepareExit.resolve(undefined)
    await rejected
    expect(h.settled()?.state).toBe('failed')
    expect(h.spawned).not.toContain('train')
    await h.provider.dispose()
  })
})
