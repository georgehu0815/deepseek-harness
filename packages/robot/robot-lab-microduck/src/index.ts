/** Supervised local MicroDuck integration; all process writes stay in session project storage. */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { RobotLabProvider, RobotLabRequest, RobotLabResult, RobotRun, RobotRunId, RobotTrial, RobotTrialBinding } from '@deepseek-ai/dsh-robot-lab'
import { parseReply } from './reply.ts'
import { LearningStore } from './learning-store.ts'
import { learningOperation } from './learning-operations.ts'

/** Provider Loader identity. */
export const name = 'robot-lab-microduck'
/** Required process, filesystem, confinement, and service capabilities. */
export const inject = ['robotLab', 'subprocess', 'fs', 'sandbox', 'sandboxPolicy']
/** Deployment-controlled compute and protocol limits. */
export interface Config {
  /** Absolute path to the installed MicroDuck Lab checkout. */
  sourceRoot: string
  /** Absolute path to the Python executable in the MicroDuck Lab environment. */
  pythonBin: string
  /** Optional isolated Python 3.12 interpreter with MLX; absence disables only MLX training. */
  mlxPythonBin?: string
  /** Relative directory below each session workspace; empty and parent-traversal segments are rejected. */
  storageDirectory: string
  /** Millisecond timeout for each non-training bridge process, including training preparation. */
  timeoutMs: number
  /** Millisecond timeout for an admitted training process. */
  trainingTimeoutMs: number
  /** Milliseconds allowed for graceful process termination before forced termination. */
  graceMs: number
  /** Maximum captured stdout bytes per process; lossy replies are rejected. */
  maxOutputBytes: number
  /** Maximum captured stderr bytes per process for failure diagnostics. */
  maxErrorBytes: number
  /** Maximum simultaneously owned training runs across sessions. */
  maxConcurrentTraining: number
  /** Maximum requested training steps per run. */
  maxTrainingSteps: number
  /** Maximum parallel training environments per run. */
  maxEnvs: number
  /** Maximum steps per simulation or evaluation episode. */
  maxSimulationSteps: number
  /** Maximum episodes per evaluation request. */
  maxEvaluationEpisodes: number
  /** Maximum keyframes in one reference clip. */
  maxClipKeys: number
  /** Maximum reference clip duration in seconds. */
  maxClipSeconds: number
  /** Minimum authored motion tempo in beats per minute. */
  minStudioBpm: number
  /** Maximum authored motion tempo in beats per minute. */
  maxStudioBpm: number
  /** Selectable positive integer beat lengths for authored motion and music. */
  studioBeatChoices: number[]
  /** Selectable positive beat lengths for individual sequence blocks. */
  studioBlockBeatChoices: number[]
  /** Maximum ordered motion blocks in one project. */
  maxProjectBlocks: number
  /** Maximum saved immutable project revisions per session. */
  maxProjects: number
  /** Maximum nonnegative weight accepted for a registered reward term. */
  maxRewardWeight: number
  /** Training-step interval passed to the trainer for checkpoint snapshots. */
  snapshotSteps: number
  /** Maximum immutable saved learning trials per session. */
  maxTrials: number
  /** Maximum immutable reflections per session. */
  maxReflections: number
  /** Maximum evaluation admission directories read or admitted by guided evaluation. */
  maxEvaluationRecords: number
  /** Inclusive UTF-8 byte bound for each host-read learning or referenced artifact record. */
  maxLearningRecordBytes: number
  /** Maximum Unicode characters in each learning brief or reflection text field. */
  maxLearningTextLength: number
}
/** Required absolute installation paths; remaining defaults bound local resource use. */
export const Config: z<Pick<Config, 'sourceRoot' | 'pythonBin'> & Partial<Config>, Config> = z.object({
  sourceRoot: z.string().required(), pythonBin: z.string().required(), mlxPythonBin: z.string(),
  storageDirectory: z.string().default('.microduck-studio'),
  timeoutMs: z.natural().default(120_000), trainingTimeoutMs: z.natural().default(3_600_000),
  graceMs: z.natural().default(3_000), maxOutputBytes: z.natural().default(32 * 1024 * 1024),
  maxErrorBytes: z.natural().default(16_384), maxConcurrentTraining: z.natural().default(1),
  maxTrainingSteps: z.natural().default(10_000_000), maxEnvs: z.natural().default(32),
  maxSimulationSteps: z.natural().default(1500), maxEvaluationEpisodes: z.natural().default(20),
  maxClipKeys: z.natural().default(512), maxClipSeconds: z.natural().default(120),
  minStudioBpm: z.natural().default(40), maxStudioBpm: z.natural().default(200),
  studioBeatChoices: z.array(z.natural()).default([16, 32]), maxProjects: z.natural().default(100),
  studioBlockBeatChoices: z.array(z.natural()).default([4, 8, 16, 32]), maxProjectBlocks: z.natural().default(8),
  maxRewardWeight: z.natural().default(1000), snapshotSteps: z.natural().default(100_000),
  maxTrials: z.natural().default(100), maxReflections: z.natural().default(100), maxEvaluationRecords: z.natural().default(200),
  maxLearningRecordBytes: z.natural().default(1024 * 1024), maxLearningTextLength: z.natural().default(2000),
})
interface OperationScope { root: string; policy: SandboxExecutionPolicy }
interface Operation { sessionId: string; controller: AbortController; settled: Promise<void> }

export { parseReply } from './reply.ts'

/** Provider owns each training process until whole-tree quiescence. */
export class MicroduckProvider implements RobotLabProvider {
  private readonly running = new Map<RobotRunId, Operation>()
  private readonly operations = new Set<Operation>()
  private readonly learningLocks = new Set<string>()
  private disposed = false
  /**
 * @param ctx - Injected host capabilities.
 * @param config - Validated deployment config. */
  constructor(private readonly ctx: Context, private readonly config: Config) {
    if (!isAbsolute(config.sourceRoot) || !isAbsolute(config.pythonBin)) throw new Error('MicroDuck sourceRoot and pythonBin must be absolute paths')
    if (config.mlxPythonBin !== undefined && !isAbsolute(config.mlxPythonBin)) throw new Error('MicroDuck mlxPythonBin must be an absolute path')
    if (isAbsolute(config.storageDirectory) || config.storageDirectory.split(/[\\/]/).some(p => p === '..' || p === '') ) throw new Error('MicroDuck storageDirectory must be a nonempty relative path without traversal')
    for (const [key, value] of Object.entries(config)) if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`MicroDuck ${key} must be a positive safe integer`)
    if (config.minStudioBpm > config.maxStudioBpm) throw new Error('MicroDuck minStudioBpm must not exceed maxStudioBpm')
    for (const key of ['studioBeatChoices', 'studioBlockBeatChoices'] as const) {
      const choices = config[key]
      if (choices.length === 0 || new Set(choices).size !== choices.length
        || choices.some(beats => !Number.isSafeInteger(beats) || beats <= 0)) throw new Error(`MicroDuck ${key} must contain distinct positive safe integers`)
    }
  }
  private async scope(session: Session): Promise<OperationScope> {
    const policy = this.ctx.sandboxPolicy.resolve({ session })
    const workspace = await this.ctx.fs.resolve(policy.workspaceRoot)
    const identity = createHash('sha256').update(session.id).digest('hex')
    const target = await this.ctx.fs.resolve(join(policy.workspaceRoot, this.config.storageDirectory, identity))
    if (!this.ctx.fs.contains(workspace, target)) throw new Error('MicroDuck storage escapes the session workspace')
    return { root: this.ctx.fs.processPath(target), policy }
  }
  private async spawn(
    scope: OperationScope, request: object, signal: AbortSignal, timeoutMs: number, pythonBin = this.config.pythonBin,
  ): Promise<{ handle: SubprocessHandle; timeout: AbortSignal }> {
    const executable = await this.ctx.subprocess.resolveExecutable(pythonBin, undefined, signal)
    if (this.disposed || signal.aborted) throw new Error('MicroDuck operation was cancelled before process creation')
    const script = fileURLToPath(new URL('../python/bridge.py', import.meta.url))
    const timeout = AbortSignal.timeout(timeoutMs)
    const argv = [executable, '-B', script, '--source', this.config.sourceRoot, '--root', scope.root]
    // Local robot operations remain workspace-confined even in a more permissive session.
    const confined = this.ctx.sandbox.confine(argv, { ...scope.policy, mode: scope.policy.mode === 'read-only' ? 'read-only' : 'workspace-write' })
    if (confined.enforcement !== 'full') throw new Error('MicroDuck requires full filesystem confinement')
    const handle = this.ctx.subprocess.spawn({ argv: confined.argv, cwd: scope.policy.workspaceRoot,
      stdio: {
        stdin: { data: JSON.stringify({ request, limits: this.config }) },
        stdout: { maxBytes: this.config.maxOutputBytes }, stderr: { maxBytes: this.config.maxErrorBytes },
      },
      graceMs: this.config.graceMs, signal: AbortSignal.any([signal, timeout]),
      env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', PYTHONPATH: undefined, PYTHONSTARTUP: undefined,
        OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', VECLIB_MAXIMUM_THREADS: '1' },
    })
    return { handle, timeout }
  }
  private async collect(handle: SubprocessHandle, timeout: AbortSignal, signal: AbortSignal): Promise<RobotLabResult> {
    let outcome: SubprocessOutcome
    try { outcome = await handle.done }
    finally { await handle.waitForExit() }
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (signal.aborted) throw new Error('MicroDuck operation cancelled')
    if (timeout.aborted) throw new Error('MicroDuck operation exceeded its configured time budget')
    if (outcome.exitCode !== 0) throw new Error(`MicroDuck bridge failed (${String(outcome.exitCode)}): ${stderr}`)
    const output = handle.collected.stdout?.readFrom(0)
    if (output === undefined || output.lossy) throw new Error('MicroDuck response exceeded maxOutputBytes')
    return parseReply(output.text, this.config)
  }
  private async call(
    scope: OperationScope, request: object, signal: AbortSignal, pythonBin = this.config.pythonBin,
  ): Promise<RobotLabResult> {
    const { handle, timeout } = await this.spawn(scope, request, signal, this.config.timeoutMs, pythonBin)
    return this.collect(handle, timeout, signal)
  }
  private async settleFile(scope: OperationScope, runId: RobotRunId, state: RobotRun['state'], error: string | null, allowMissing = false): Promise<RobotRun | undefined> {
    const target = await this.ctx.fs.resolve(join(scope.root, 'runs', runId, 'manifest.json'))
    if (allowMissing && await this.ctx.fs.stat(target) === undefined) return undefined
    const parsed = parseReply(JSON.stringify({ operation: 'run', run: JSON.parse(await this.ctx.fs.readText(target)) as unknown }), this.config)
    if (parsed.operation !== 'run') throw new Error('Unexpected persisted run record')
    // The frozen manifest carries Python-computed provenance hashes; re-serializing
    // it in JS drops integer-valued floats' ".0" and breaks those hashes, so the
    // mutable terminal state lives in a sidecar the Python bridge overlays on read.
    const statePath = await this.ctx.fs.resolve(join(scope.root, 'runs', runId, 'state.json'))
    const settledText = await this.ctx.fs.stat(statePath) === undefined ? undefined : await this.ctx.fs.readText(statePath)
    const existing = settledText === undefined ? undefined : JSON.parse(settledText) as Pick<RobotRun, 'state' | 'error' | 'finishedAt'>
    const current: RobotRun = { ...parsed.run, ...existing }
    // Run identities are never re-admitted; an absent owner cannot start writing after this check.
    if (state === 'interrupted' && (this.running.has(runId) || !['starting', 'running'].includes(current.state))) return current
    const settled: Pick<RobotRun, 'state' | 'error' | 'finishedAt'> = { state, error, finishedAt: new Date().toISOString() }
    if (scope.policy.mode !== 'read-only') await this.ctx.fs.writeText(statePath, JSON.stringify(settled) + '\n', undefined, undefined, scope.policy)
    return { ...parsed.run, ...settled }
  }
  /** Execute an owned operation.
 * @param session - Authoritative owner.
 * @param request - Wire request.
 * @param signal - Request cancellation. @returns Committed result. */
  async execute(session: Session, request: RobotLabRequest, signal: AbortSignal): Promise<RobotLabResult> {
    if (this.disposed) throw new Error('MicroDuck provider is disposed')
    const runId = request.operation === 'train' || request.operation === 'train_trial' ? `run-${randomUUID()}` as RobotRunId : undefined
    if (runId !== undefined && this.running.size >= this.config.maxConcurrentTraining) throw new Error('Local training capacity is occupied; stop or wait for the active run')
    const lock = request.operation === 'train_trial' ? `${session.id}:trial:${request.trialId}`
      : ['save_trial', 'save_reflection', 'evaluate_trial', 'evaluate'].includes(request.operation) ? `${session.id}:learning-write` : undefined
    if (lock !== undefined && this.learningLocks.has(lock)) throw new Error('Learning admission is already in progress; wait and reload its saved record')
    if (lock !== undefined) this.learningLocks.add(lock)
    const operation: Operation = { sessionId: session.id, controller: new AbortController(), settled: Promise.resolve() }
    this.operations.add(operation)
    if (runId !== undefined) this.running.set(runId, operation)
    return new Promise<RobotLabResult>((resolve, reject) => {
      const publish = (result: RobotLabResult) => { resolve(this.boundedResult(result)) }
      operation.settled = Promise.resolve().then(() => this.executeOwned(session, request, signal, operation, runId, publish, reject))
        .then(result => this.boundedResult(result))
        .then(resolve, (error: unknown) => {
          const failure = error instanceof Error ? error : new Error(String(error))
          reject(failure); throw failure
        })
        .finally(() => {
          this.operations.delete(operation)
          if (runId !== undefined) this.running.delete(runId)
          if (lock !== undefined) this.learningLocks.delete(lock)
        })
      // Requests observe admission errors; detached training still needs a settlement-error observer.
      void operation.settled.catch((error: unknown) => { if (runId !== undefined) this.ctx.logger.error('MicroDuck run settlement failed: %s', String(error)) })
    })
  }
  private boundedResult(result: RobotLabResult): RobotLabResult {
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > this.config.maxOutputBytes) throw new Error('MicroDuck result exceeds maxOutputBytes')
    return result
  }
  private async executeOwned(
    session: Session, request: RobotLabRequest, caller: AbortSignal, operation: Operation, runId: RobotRunId | undefined,
    publish: (result: RobotLabResult) => void, rejectAdmission: (error: unknown) => void,
  ): Promise<RobotLabResult> {
    const signal = AbortSignal.any([caller, operation.controller.signal, AbortSignal.timeout(this.config.timeoutMs)])
    const scope = await this.scope(session)
    if (this.disposed || signal.aborted) throw new Error('MicroDuck operation was cancelled before admission')
    if (request.operation === 'save_project' && scope.policy.mode === 'read-only') throw new Error('Saving projects requires writable session project storage')
    if (['save_trial', 'train_trial', 'evaluate_trial', 'save_reflection', 'evaluate'].includes(request.operation) && scope.policy.mode === 'read-only') throw new Error('Learning changes require writable session storage')
    const learningRoot = join(scope.policy.workspaceRoot, this.config.storageDirectory, createHash('sha256').update(session.id).digest('hex'))
    const store = new LearningStore(this.ctx.fs, learningRoot, scope.policy, this.config, signal)
    const learning = await learningOperation(request, store, this.config, async value => this.call(scope, value, signal), async (run) => {
      if (!['starting', 'running'].includes(run.state) || this.running.has(run.id)) return run
      return await this.settleFile(scope, run.id, 'interrupted', 'Owning process is not present; training was not automatically resumed.') ?? run
    })
    if (learning !== undefined) return learning
    if (request.operation === 'stop') {
      const active = this.running.get(request.runId)
      if (active !== undefined && active.sessionId !== session.id) throw new Error('Training run belongs to another session')
      if (active !== undefined) { active.controller.abort(); await active.settled }
      const reply = await this.call(scope, { operation: 'run', runId: request.runId }, signal)
      if (reply.operation !== 'run') throw new Error('Unexpected run reply')
      return { operation: 'stop', run: reply.run }
    }
    if (request.operation !== 'train' && request.operation !== 'train_trial') {
      try {
        const result = await this.call(scope, request, signal)
        if (result.operation === 'readiness' && this.config.mlxPythonBin !== undefined) {
          try {
            const optional = await this.call(scope, { operation: 'readiness', backend: 'mlx' }, signal, this.config.mlxPythonBin)
            if (optional.operation !== 'readiness') throw new Error('Unexpected MLX readiness reply')
            result.readiness.backends.mlx = optional.readiness.backends.mlx
          } catch (error) {
            signal.throwIfAborted()
            result.readiness.backends.mlx = { available: false, reason: String(error), learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} }
          }
        }
        const runs = result.operation === 'runs' ? result.runs : result.operation === 'run' ? [result.run] : []
        for (const run of runs) {
          if (!['starting', 'running'].includes(run.state) || this.running.has(run.id)) continue
          const error = 'Owning process is not present; training was not automatically resumed.'
          const updated = await this.settleFile(scope, run.id, 'interrupted', error)
          Object.assign(run, updated)
        }
        return result
      } catch (error) {
        if (request.operation !== 'readiness') throw error
        const reason = error instanceof Error ? error.message : String(error)
        const disabled = { available: false, reason }
        return { operation: 'readiness', readiness: { ready: false, reason, versions: {}, defaultBackend: 'cpu',
          backends: { cpu: { ...disabled, learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
            mlx: { ...disabled, learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} } },
          capabilities: { train: disabled, simulate: disabled, evaluate: disabled, deploy: disabled } } }
      }
    }
    if (scope.policy.mode === 'read-only') throw new Error('Training requires writable session project storage')
    if (runId === undefined) throw new Error('Training admission requires an owned run identity')
    let trial: RobotTrial | undefined
    const requestedSpec = request.operation === 'train' ? request.spec : (trial = await store.trial(request.trialId)).recipe.spec
    if (trial !== undefined && await store.binding(trial) !== null) throw new Error('Trial already has a run; save a new trial to retry')
    const backend = requestedSpec.backend === undefined ? 'cpu' : requestedSpec.backend
    const pythonBin = backend === 'cpu' ? this.config.pythonBin : this.config.mlxPythonBin
    if (pythonBin === undefined) throw new Error('MLX GPU training is unavailable: configure mlxPythonBin; no CPU fallback is performed')
    const spec = { ...requestedSpec, backend }
    const lifetime = operation.controller.signal
    let prepared: RobotLabResult
    let process: { handle: SubprocessHandle; timeout: AbortSignal }
    try {
      prepared = await this.call(scope, { operation: 'prepare_train', runId, spec }, signal, pythonBin)
      if (prepared.operation !== 'train') throw new Error('Unexpected training preparation reply')
      if (trial !== undefined) {
        const binding: RobotTrialBinding = await store.bind(trial, prepared.run)
        prepared = { operation: 'train_trial', trial, binding, run: prepared.run }
      }
      this.boundedResult(prepared)
      signal.throwIfAborted()
      // Once admitted, browser/request disconnect does not cancel the training process.
      process = await this.spawn(scope, { operation: 'train', runId }, lifetime, this.config.trainingTimeoutMs, pythonBin)
    } catch (error) {
      const run = await this.settleFile(scope, runId, lifetime.aborted ? 'stopped' : 'failed', lifetime.aborted ? null : String(error), true)
      if (run === undefined) throw error
      rejectAdmission(error)
      return { operation: 'train', run }
    }
    publish(prepared)
    try { await this.collect(process.handle, process.timeout, lifetime) }
    catch (error) { await this.settleFile(scope, runId, lifetime.aborted ? 'stopped' : 'failed', lifetime.aborted ? null : String(error)) }
    return prepared
  }
  /** Stop every owned process and await persistence and whole-tree exit. @returns Completion after quiescence. */
  async dispose(): Promise<void> {
    this.disposed = true
    const operations = [...this.operations]
    for (const operation of operations) operation.controller.abort()
    await Promise.allSettled(operations.map(operation => operation.settled))
  }
}
/** Mount the provider and await process cleanup on removal.
 * @param ctx - Injected capabilities.
 * @param config - Deployment configuration. */
export function apply(ctx: Context, config: Config): void {
  const provider = new MicroduckProvider(ctx, config)
  ctx.effect(() => ctx.robotLab.registerProvider(provider))
  ctx.effect(() => () => provider.dispose(), 'MicroDuck process supervision')
}
