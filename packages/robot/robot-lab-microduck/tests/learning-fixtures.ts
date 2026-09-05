/** Complete Python-compatible records and a typed filesystem double for host learning tests. */
import { join, resolve, sep } from 'node:path'
import { vi } from 'vitest'
import { FsTargetKey, FsVersion, type FileSystem, type FsInfo, type FsPathInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import type {
  RobotEvaluation, RobotEvaluationId, RobotPolicyId, RobotProjectId, RobotProjectRevision,
  RobotProjectRevisionId, RobotProfileId, RobotRun, RobotRunId, RobotTemplateId, RobotTrial, RobotTrialRecipe,
} from '@deepseek-ai/dsh-robot-lab'

/** Build a saved version-2 project with a complete fourteen-joint reference.
 * @returns Independently mutable valid project fixture.
 */
export function learningProject(): RobotProjectRevision {
  const template = {
    id: 'disco-groove' as RobotTemplateId, version: 1 as const, label: 'Disco Groove', description: 'Authored reference',
    experimental: true as const, category: 'dance' as const, difficulty: 'starter' as const, behaviorId: 'imitate',
    trainingWeights: { travel: 0 }, defaultParameters: { bpm: 96, beats: 32, moveSize: 0.5 },
  }
  return {
    version: 2, id: 'revision-00000000-0000-4000-8000-000000000001' as RobotProjectRevisionId,
    projectId: 'project-00000000-0000-4000-8000-000000000001' as RobotProjectId,
    createdAt: '2026-01-01T00:00:00Z', sha256: 'a'.repeat(64),
    recipe: { projectId: null, name: '我的鸭鸭 🦆', profileId: 'microduck' as RobotProfileId, templateId: template.id,
      templateVersion: 1, parameters: { bpm: 96, beats: 32, moveSize: 0.5 },
      music: { version: 1, style: 'disco', bpm: 96, beats: 32, seed: 42 } },
    profile: { id: 'microduck' as RobotProfileId, label: 'MicroDuck', modelSha256: 'b'.repeat(64),
      rootBody: { name: 'root', index: 1 }, hardwareAvailable: false,
      joints: Array.from({ length: 14 }, (_, index) => ({ name: `joint-${index}`, index: index + 1,
        lower: -1, upper: 1, defaultPosition: 0, unit: 'rad' as const })) },
    template, blocks: [{ template: structuredClone(template), beats: 32, moveSize: 0.5 }],
    training: { behaviorId: 'imitate', weights: { travel: 0 } },
    clip: { version: 1, name: '我的鸭鸭 🦆', duration: 20, loop: true,
      keys: [0, 20].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) },
  }
}

/** Build a guided recipe whose backend remains unresolved until save.
 * @param project - Frozen project selected for training.
 * @returns Independent recipe with four prospective learning-brief strings.
 */
export function learningRecipe(project = learningProject()): RobotTrialRecipe {
  return {
    spec: { name: `project-${project.projectId}`, projectRevisionId: project.id, behaviorId: project.training.behaviorId,
      steps: 256, envs: 1, seed: 42, actuator: 'bam', weights: { ...project.training.weights, pose: 1 }, clip: null },
    brief: { goal: 'Stay upright while following the reference.', prediction: 'Lower travel reward reduces drift.',
      plannedChange: 'Set travel to zero.', evidence: 'Measure upright fraction and pose RMSE in two seeded episodes.' },
    evaluation: { episodes: 2, stepsPerEpisode: 100, seed: 5, maxTerminations: 0, minMeanUprightFraction: 0.8 },
    parentReflectionId: null,
  }
}

/** Build the actual completed run produced from a saved trial.
 * @param trial - Saved trial with a resolved learner backend.
 * @param project - Its frozen project snapshot.
 * @returns Complete format-3 run and opaque Python hashes.
 */
export function learningRun(trial: RobotTrial, project = learningProject()): RobotRun {
  const id = 'run-00000000-0000-4000-8000-000000000001' as RobotRunId
  const backend = trial.recipe.spec.backend ?? 'cpu'
  const device = backend === 'mlx' ? 'metal' : 'cpu'
  return {
    formatVersion: 3, id, state: 'completed', createdAt: trial.createdAt, finishedAt: trial.createdAt,
    spec: { ...structuredClone(trial.recipe.spec), backend,
      clip: structuredClone(project.clip), projectSnapshot: structuredClone(project) },
    observationProfile: 'microduck-lab-body-phase-61', recipeHash: 'c'.repeat(64), sourceFingerprint: 'd'.repeat(64),
    progress: { steps: trial.recipe.spec.steps, total: trial.recipe.spec.steps, elapsedSeconds: 1, reward: 1 },
    error: null, policyId: `run:${id}` as RobotPolicyId, policySha256: 'e'.repeat(64),
    provenance: {
      bridgeSha256: 'f'.repeat(64), dependencyVersions: { mujoco: '3.10.0' },
      bam: { source: 'fallback', parameters: { kt: 0.36, damping: 0.1 }, sha256: '1'.repeat(64) },
      environment: { domainRandomization: false, randomYaw: false, standingSpawns: true, assistance: false,
        updateDevice: device, observationNoise: true, actionDelay: true },
      trainer: { backend, learnerDevice: device, physicsDevice: 'cpu', pythonVersion: '3.12.7', platform: 'Darwin',
        architecture: 'arm64', hardware: 'fixture', dependencyVersions: { numpy: '2.2.6' },
        helperSha256: backend === 'mlx' ? { 'mlx_ppo.py': '2'.repeat(64) } : {},
        recipe: { algorithm: backend === 'mlx' ? 'dsh-mlx-ppo-v1' : 'ppo' }, sha256: '3'.repeat(64) },
    },
  }
}

/** Build a complete admission-matching evaluation of the actual trial run.
 * @param trial - Saved criteria and earliest evidence timestamp.
 * @param run - Completed run with frozen policy and BAM provenance.
 * @returns Complete deterministic evaluation, with no physical approval claim.
 */
export function learningEvaluation(trial: RobotTrial, run: RobotRun): RobotEvaluation {
  const spec = { ...trial.recipe.evaluation, policyId: run.policyId! }
  return {
    id: 'eval-00000000-0000-4000-8000-000000000001' as RobotEvaluationId,
    createdAt: trial.createdAt, evaluatedAt: trial.createdAt, policyId: run.policyId!, policyHash: run.policySha256!,
    spec, observationProfile: run.observationProfile,
    physics: { actuator: 'bam', bam: structuredClone(run.provenance.bam), observationNoise: false,
      actionDelay: true, domainRandomization: false, randomYaw: false },
    episodes: Array.from({ length: spec.episodes }, (_, index) => ({ seed: spec.seed + index, steps: spec.stepsPerEpisode,
      terminated: false, reward: 1.5, uprightFraction: 0.9, poseRmse: 0.25, bamSettings: { delay: null, kt: 0.36 } })),
    passed: spec.minMeanUprightFraction <= 0.9, limitations: ['Deterministic simulation, not hardware approval.'],
  }
}

/** In-memory fs operations used by LearningStore and provider-owned record reads.
 * @param root - Session storage root.
 * @returns Typed seam methods, raw bytes for tamper tests, and write/read observations.
 */
export function memoryLearningFs(root = '/owned/store') {
  const files = new Map<string, Uint8Array>()
  const special = new Map<string, 'symlink' | 'other'>()
  const aliases = new Map<string, string>()
  const version = FsVersion('fixture-version')
  function target(path: string): FsTarget { return { targetKey: FsTargetKey(path), displayPath: path } }
  function info(path: string): FsPathInfo | undefined {
    if (special.has(path)) return { type: special.get(path)!, version }
    const bytes = files.get(path)
    if (bytes !== undefined) return { type: 'file', version, size: bytes.length }
    if ([...files.keys(), ...special.keys()].some(key => key.startsWith(`${path}${sep}`))) return { type: 'directory', version }
    return undefined
  }
  const methods = {
    resolve: vi.fn<FileSystem['resolve']>(async (path, options) => {
      options?.signal?.throwIfAborted()
      const normalized = resolve(options?.cwd ?? root, path)
      return target(aliases.get(normalized) ?? normalized)
    }),
    processPath: vi.fn<FileSystem['processPath']>(resolved => resolved.displayPath),
    contains: vi.fn<FileSystem['contains']>((parent, child) => child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}${sep}`)),
    lstat: vi.fn<FileSystem['lstat']>(async (path, options, signal) => {
      signal?.throwIfAborted()
      return info(resolve(options?.cwd ?? root, path))
    }),
    stat: vi.fn<FileSystem['stat']>(async (resolved, signal) => {
      signal?.throwIfAborted()
      const result = info(resolved.displayPath)
      return result === undefined ? undefined : { ...result, type: result.type === 'symlink' ? 'other' : result.type } satisfies FsInfo
    }),
    listDir: vi.fn<FileSystem['listDir']>(async (resolved, signal) => {
      signal?.throwIfAborted()
      const prefix = `${resolved.displayPath}${sep}`
      const names = new Set([...files.keys(), ...special.keys()]
        .filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).split(sep)[0]!))
      return [...names].sort().map((name) => {
        const path = join(resolved.displayPath, name)
        const result = info(path)!
        return { name, type: result.type === 'symlink' ? 'other' as const : result.type, target: target(path), version }
      })
    }),
    readBytes: vi.fn<FileSystem['readBytes']>(async (resolved, signal, maxBytes) => {
      signal?.throwIfAborted()
      const bytes = files.get(resolved.displayPath)
      if (bytes === undefined) throw new Error(`ENOENT: ${resolved.displayPath}`)
      if (bytes.length > maxBytes) throw new Error('FS_TOO_LARGE')
      return bytes.slice()
    }),
    readText: vi.fn<FileSystem['readText']>(async (resolved, signal) => {
      signal?.throwIfAborted()
      const bytes = files.get(resolved.displayPath)
      if (bytes === undefined) throw new Error(`ENOENT: ${resolved.displayPath}`)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }),
    writeText: vi.fn<FileSystem['writeText']>(async (resolved, content, expected, signal, policy) => {
      signal?.throwIfAborted()
      if (policy?.mode === 'read-only') throw new Error('read-only')
      const prior = files.get(resolved.displayPath)
      if (expected?.kind === 'createIfAbsent' && prior !== undefined) throw new Error('FS_NOT_OBSERVED')
      files.set(resolved.displayPath, new TextEncoder().encode(content))
      return { operation: prior === undefined ? 'create' : 'update', version,
        before: prior === undefined ? null : new TextDecoder().decode(prior), after: content }
    }),
  } satisfies Pick<FileSystem, 'resolve' | 'processPath' | 'contains' | 'lstat' | 'stat' | 'listDir' | 'readBytes' | 'readText' | 'writeText'>
  function path(...parts: string[]): string { return join(root, ...parts) }
  function put(parts: string[], value: unknown): void { files.set(path(...parts), new TextEncoder().encode(JSON.stringify(value) + '\n')) }
  function json(...parts: string[]): unknown { return JSON.parse(new TextDecoder().decode(files.get(path(...parts)))) as unknown }
  // Only the declared typed methods are needed; unrelated service lifecycle and streaming methods are not simulated.
  return { root, files, special, aliases, methods, fs: methods as unknown as FileSystem, path, put, json }
}

/** Store matching request/report JSON records, retaining Python admission field names.
 * @param memory - Test filesystem.
 * @param report - Complete evaluation.
 * @param complete - False retains only the immutable admission for interruption tests.
 */
export function putLearningEvaluation(memory: ReturnType<typeof memoryLearningFs>, report: RobotEvaluation, complete = true): void {
  const { episodes: _episodes, passed: _passed, limitations: _limitations, evaluatedAt: _evaluatedAt, ...admission } = report
  memory.put(['evaluations', report.id, 'request.json'], admission)
  if (complete) memory.put(['evaluations', report.id, 'report.json'], report)
}
