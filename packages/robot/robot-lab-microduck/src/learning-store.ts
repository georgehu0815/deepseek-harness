/** Host-owned immutable learning records; Python projects, manifests and runtime files are never rewritten. */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { validateRobotRequest, type RobotEvaluation, type RobotEvaluationId, type RobotProjectRevision,
  type RobotReflection, type RobotReflectionId, type RobotReflectionRequest, type RobotRun, type RobotRunId,
  type RobotTrial, type RobotTrialBinding, type RobotTrialId, type RobotTrialRecipe } from '@deepseek-ai/dsh-robot-lab'
import { parseReply } from './reply.ts'
import { evaluationReachedFullHorizon, validateEvaluationAdmission, validateEvaluationReport } from './evaluation-validation.ts'

/** Deployment bounds apply to full records and collections, including historical reads. */
export interface LearningLimits {
  maxTrials: number
  maxReflections: number
  maxEvaluationRecords: number
  maxLearningRecordBytes: number
  maxLearningTextLength: number
  maxEvaluationEpisodes: number
  maxSimulationSteps: number
  maxTrainingSteps: number
  maxEnvs: number
  maxRewardWeight: number
  maxClipKeys: number
  maxClipSeconds: number
  maxProjects: number
  maxProjectBlocks: number
}
function row(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Learning record must be an object')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new Error('Learning record has missing or unsupported fields')
  return record
}
function identity(value: unknown, prefix: string): void {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).test(value)) throw new Error(`Invalid ${prefix} identity`)
}
function checksum(value: unknown): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Learning record requires a SHA256 digest')
}
function timestamp(value: unknown): void {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Learning record requires a timestamp with timezone')
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
    || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Learning record requires finite JSON values')
  return JSON.stringify(value)
}
/** Hash host-owned JSON only; Python provenance hashes remain opaque references.
 * @param value - Complete JSON value.
 * @returns Stable SHA256 digest independent of object field order.
 */
export function learningHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
function verify(record: Record<string, unknown>): void {
  if (record.version !== 1) throw new Error('Unsupported learning record version; expected 1')
  checksum(record.sha256); timestamp(record.createdAt)
  const { sha256, ...content } = record
  if (learningHash(content) !== sha256) throw new Error('Learning record content hash mismatch')
}

/** Session-scoped filesystem access with bounded reads and immutable create-only publication. */
export class LearningStore {
  /** @param fs - Injected filesystem service.
   * @param root - Canonical session-owned storage root.
   * @param policy - Explicit session write policy.
   * @param limits - Resolved deployment bounds.
   * @param signal - Owning operation cancellation.
   */
  constructor(private readonly fs: FileSystem, private readonly root: string, private readonly policy: SandboxExecutionPolicy,
    private readonly limits: LearningLimits, private readonly signal: AbortSignal) {}
  private async target(parts: string[]): Promise<FsTarget> {
    this.signal.throwIfAborted()
    const base = await this.fs.resolve(this.root, { signal: this.signal })
    const offset = relative(this.policy.workspaceRoot, this.root)
    if (isAbsolute(offset) || offset.split(/[\\/]/).includes('..')) throw new Error('Learning storage escapes the session workspace')
    const ancestors = [...offset.split(/[\\/]/).filter(Boolean), ...parts]
    for (let count = 1; count <= ancestors.length; count += 1) {
      const path = join(this.policy.workspaceRoot, ...ancestors.slice(0, count))
      const stat = await this.fs.lstat(path, undefined, this.signal)
      if (stat?.type === 'symlink' || stat?.type === 'other') throw new Error('Learning storage cannot use symbolic links or special files')
    }
    const target = await this.fs.resolve(join(this.root, ...parts), { signal: this.signal })
    if (!this.fs.contains(base, target)) throw new Error('Learning record escapes this session')
    return target
  }
  private async read(parts: string[], optional = false): Promise<unknown> {
    const target = await this.target(parts)
    if (optional && await this.fs.stat(target, this.signal) === undefined) return undefined
    const bytes = await this.fs.readBytes(target, this.signal, this.limits.maxLearningRecordBytes)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  }
  private async names(parts: string[], maximum: number, prefix: string, suffix: string): Promise<string[]> {
    const target = await this.target(parts)
    if (await this.fs.stat(target, this.signal) === undefined) return []
    const entries = await this.fs.listDir(target, this.signal)
    if (entries.length > maximum) throw new Error('Learning history exceeds its configured record count')
    return entries.map((entry) => {
      const id = suffix === '' ? entry.name : entry.name.endsWith(suffix) ? entry.name.slice(0, -suffix.length) : ''
      identity(id, prefix)
      return id
    })
  }
  private async create(parts: string[], value: unknown): Promise<void> {
    if (this.policy.mode === 'read-only') throw new Error('Learning changes require writable session storage')
    const text = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(text, 'utf8') > this.limits.maxLearningRecordBytes) throw new Error('Learning record exceeds maxLearningRecordBytes')
    const target = await this.target(parts)
    await this.fs.writeText(target, text, { kind: 'createIfAbsent' }, this.signal, { ...this.policy, mode: 'workspace-write' })
  }
  private textBounds(values: string[]): void {
    if (values.some(value => Array.from(value).length > this.limits.maxLearningTextLength)) throw new Error('Learning text exceeds maxLearningTextLength')
  }
  /** Enforce deployment bounds on a structurally validated saved recipe.
   * @param recipe - Public guided recipe.
   */
  validateRecipe(recipe: RobotTrialRecipe): void {
    validateRobotRequest({ operation: 'save_trial', recipe })
    this.textBounds([recipe.brief.goal, recipe.brief.prediction, recipe.brief.plannedChange, recipe.brief.evidence])
    const { spec, evaluation } = recipe
    if (spec.steps > this.limits.maxTrainingSteps || spec.envs > this.limits.maxEnvs
      || Object.values(spec.weights).some(weight => weight > this.limits.maxRewardWeight)) throw new Error('Trial training exceeds configured limits')
    if (evaluation.episodes > this.limits.maxEvaluationEpisodes || evaluation.stepsPerEpisode > this.limits.maxSimulationSteps) throw new Error('Trial evaluation exceeds configured limits')
  }
  /** Read a frozen project without executing Python or changing its content.
   * @param id - Session-owned project revision.
   * @returns Validated existing version-2 project.
   */
  async project(id: RobotTrialRecipe['spec']['projectRevisionId']): Promise<RobotProjectRevision> {
    identity(id, 'revision')
    const reply = parseReply(JSON.stringify({ operation: 'project', project: await this.read(['projects', `${id}.json`]) }), this.limits)
    if (reply.operation !== 'project' || reply.project.id !== id) throw new Error('Project identity differs from its filename')
    return reply.project
  }
  /** Save a new immutable trial; no run is admitted.
   * @param recipe - Complete guided recipe.
   * @param project - Exact project snapshot validated by the unchanged Python project reader.
   * @returns Committed trial with resolved CPU default and the validated project digest.
   */
  async saveTrial(recipe: RobotTrialRecipe, project: RobotProjectRevision): Promise<RobotTrial> {
    this.validateRecipe(recipe)
    if ((await this.names(['learning', 'trials'], this.limits.maxTrials, 'trial', '.json')).length >= this.limits.maxTrials) throw new Error('Maximum saved trials reached')
    const storedProject = await this.project(recipe.spec.projectRevisionId)
    if (project.id !== recipe.spec.projectRevisionId || !isDeepStrictEqual(project, storedProject)) throw new Error('Project changed after Python validation; reload before saving the trial')
    if (recipe.parentReflectionId !== null) {
      const parent = await this.reflection(recipe.parentReflectionId)
      if (Date.parse(parent.createdAt) > Date.now()) throw new Error('Cannot save a child trial before its parent reflection')
    }
    const content = { version: 1 as const, id: `trial-${randomUUID()}` as RobotTrialId, createdAt: new Date().toISOString(),
      projectRevisionId: project.id, projectSha256: project.sha256,
      recipe: structuredClone({ ...recipe, spec: { ...recipe.spec, backend: recipe.spec.backend ?? 'cpu' } }) }
    const trial = { ...content, sha256: learningHash(content) }
    await this.create(['learning', 'trials', `${trial.id}.json`], trial)
    return trial
  }
  /** Read an immutable trial and check its frozen project reference.
   * @param id - Trial identity.
   * @returns Validated trial.
   */
  async trial(id: RobotTrialId): Promise<RobotTrial> { return this.readTrial(id, new Set()) }
  private async readTrial(id: RobotTrialId, ancestors: Set<RobotTrialId>): Promise<RobotTrial> {
    identity(id, 'trial')
    if (ancestors.has(id) || ancestors.size >= this.limits.maxTrials) throw new Error('Trial ancestry contains a cycle or exceeds maxTrials')
    ancestors.add(id)
    const value = row(await this.read(['learning', 'trials', `${id}.json`]), ['version', 'id', 'createdAt', 'projectRevisionId', 'projectSha256', 'recipe', 'sha256'])
    verify(value)
    if (value.id !== id) throw new Error('Trial identity differs from filename')
    validateRobotRequest({ operation: 'save_trial', recipe: value.recipe })
    const trial = value as unknown as RobotTrial
    this.validateRecipe(trial.recipe)
    if (trial.recipe.spec.backend === undefined) throw new Error('Saved trial requires a resolved backend')
    const project = await this.project(trial.recipe.spec.projectRevisionId)
    if (trial.projectRevisionId !== project.id || trial.projectSha256 !== project.sha256) throw new Error('Trial project identity or content differs')
    if (trial.recipe.parentReflectionId !== null) {
      const parent = await this.readReflection(trial.recipe.parentReflectionId)
      if (parent.trialId === trial.id || Date.parse(parent.createdAt) > Date.parse(trial.createdAt)) throw new Error('Trial parent must reference an earlier reflection')
      await this.checkReflection(parent, ancestors)
    }
    return trial
  }
  /** List bounded trial identities without loading run state.
   * @returns Saved trial identities in stable filename order.
   */
  async trialIds(): Promise<RobotTrialId[]> { return await this.names(['learning', 'trials'], this.limits.maxTrials, 'trial', '.json') as RobotTrialId[] }
  /** Read an existing run and its host terminal-state overlay without changing Python JSON.
   * @param id - Owned run identity.
   * @returns Structurally validated format-3 run.
   */
  async run(id: RobotRunId): Promise<RobotRun> {
    identity(id, 'run')
    const reply = parseReply(JSON.stringify({ operation: 'run', run: await this.read(['runs', id, 'manifest.json']) }), this.limits)
    if (reply.operation !== 'run' || reply.run.id !== id) throw new Error('Run identity differs from filename')
    const state = await this.read(['runs', id, 'state.json'], true)
    if (state !== undefined) {
      const override = row(state, ['state', 'error', 'finishedAt'])
      if (!['failed', 'stopped', 'interrupted'].includes(String(override.state)) || override.error !== null && typeof override.error !== 'string') throw new Error('Invalid terminal run state')
      timestamp(override.finishedAt)
      Object.assign(reply.run, override)
    }
    return reply.run
  }
  /** Check an actual prepared run against the saved learning recipe.
   * @param trial - Immutable trial.
   * @param run - Existing prepared or completed run.
   */
  matchRun(trial: RobotTrial, run: RobotRun): void {
    const project = run.spec.projectSnapshot
    if (project === undefined || project.id !== trial.projectRevisionId || project.sha256 !== trial.projectSha256
      || !isDeepStrictEqual(run.spec, { ...trial.recipe.spec, clip: project.clip, projectSnapshot: project })) throw new Error('Run differs from frozen trial recipe or project')
  }
  /** Read a trial's single immutable run binding, if admitted.
   * @param trial - Validated saved trial.
   * @returns Validated binding or null for an untrained trial.
   */
  async binding(trial: RobotTrial): Promise<RobotTrialBinding | null> {
    const raw = await this.read(['learning', 'bindings', `${trial.id}.json`], true)
    if (raw === undefined) return null
    const value = row(raw, ['version', 'trialId', 'trialSha256', 'runId', 'recipeHash', 'createdAt', 'sha256'])
    verify(value); identity(value.runId, 'run'); checksum(value.recipeHash)
    if (value.trialId !== trial.id || value.trialSha256 !== trial.sha256) throw new Error('Trial binding identity differs')
    const binding = value as unknown as RobotTrialBinding
    const run = await this.run(binding.runId)
    this.matchRun(trial, run)
    if (run.recipeHash !== binding.recipeHash) throw new Error('Trial binding recipe hash differs')
    return binding
  }
  /** Commit one prepared run binding before trainer creation; existing bindings never overwrite.
   * @param trial - Saved trial.
   * @param run - Actual Python-prepared run.
   * @returns Immutable binding.
   */
  async bind(trial: RobotTrial, run: RobotRun): Promise<RobotTrialBinding> {
    this.matchRun(trial, run)
    const content = { version: 1 as const, trialId: trial.id, trialSha256: trial.sha256, runId: run.id,
      recipeHash: run.recipeHash, createdAt: new Date().toISOString() }
    const binding = { ...content, sha256: learningHash(content) }
    await this.create(['learning', 'bindings', `${trial.id}.json`], binding)
    return binding
  }
  /** Read a completed assessment, validating its immutable admission/report pair.
   * @param id - Evaluation identity.
   * @returns Completed validated report; request-only attempts reject.
   */
  async evaluation(id: RobotEvaluationId): Promise<RobotEvaluation> {
    identity(id, 'eval')
    const admission = validateEvaluationAdmission(await this.read(['evaluations', id, 'request.json']), this.limits)
    if (admission.id !== id) throw new Error('Evaluation identity differs from directory')
    const report = validateEvaluationReport(admission, await this.read(['evaluations', id, 'report.json']), this.limits)
    if (!evaluationReachedFullHorizon(report)) throw new Error('nonterminated episode did not execute the full horizon')
    await this.validateEvaluationRun(report)
    return report
  }
  private async validateEvaluationRun(report: RobotEvaluation): Promise<void> {
    if (!report.policyId.startsWith('run:')) return
    const run = await this.run(report.policyId.slice(4) as RobotRunId)
    if (run.state !== 'completed' || run.policyId !== report.policyId || run.policySha256 !== report.policyHash
      || run.observationProfile !== report.observationProfile || !isDeepStrictEqual(run.provenance.bam, report.physics.bam)) throw new Error('Evaluation differs from the completed run policy or physics')
  }
  /** List completed validated reports; unfinished admissions are counted, not treated as evidence.
   * @returns Bounded reports and request-only count.
   */
  async evaluations(): Promise<{ evaluations: RobotEvaluation[]; incompleteCount: number }> {
    const ids = await this.names(['evaluations'], this.limits.maxEvaluationRecords, 'eval', '')
    const evaluations: RobotEvaluation[] = []
    let incompleteCount = 0
    for (const value of ids) {
      const id = value as RobotEvaluationId
      const report = await this.read(['evaluations', id, 'report.json'], true)
      const request = await this.read(['evaluations', id, 'request.json'], report === undefined)
      if (report === undefined && request === undefined) { incompleteCount += 1; continue }
      const admission = validateEvaluationAdmission(request, this.limits)
      if (admission.id !== id) throw new Error('Evaluation identity differs from directory')
      if (report === undefined) incompleteCount += 1
      else {
        const evaluation = validateEvaluationReport(admission, report, this.limits)
        if (!evaluationReachedFullHorizon(evaluation)) incompleteCount += 1
        else {
          await this.validateEvaluationRun(evaluation)
          evaluations.push(evaluation)
        }
      }
    }
    return { evaluations, incompleteCount }
  }
  /** Resolve the actual completed policy of a saved trial.
   * @param trial - Validated trial.
   * @returns Completed run with policy identity/hash.
   */
  async completedRun(trial: RobotTrial): Promise<RobotRun & { policyId: NonNullable<RobotRun['policyId']>; policySha256: string }> {
    const binding = await this.binding(trial)
    if (binding === null) throw new Error('Trial has no admitted run')
    const run = await this.run(binding.runId)
    if (run.state !== 'completed' || run.policyId !== `run:${run.id}` || run.policySha256 === null) throw new Error('Trial requires a completed policy with its frozen SHA256')
    checksum(run.policySha256)
    return run as RobotRun & { policyId: NonNullable<RobotRun['policyId']>; policySha256: string }
  }
  /** Check evidence against the exact trial policy and predeclared criteria.
   * @param trial - Saved trial.
   * @param evaluation - Validated completed report.
   * @returns Bound completed run.
   */
  async matchEvaluation(trial: RobotTrial, evaluation: RobotEvaluation): Promise<RobotRun> {
    const run = await this.completedRun(trial)
    if (evaluation.policyId !== run.policyId || evaluation.policyHash !== run.policySha256
      || evaluation.observationProfile !== run.observationProfile
      || !isDeepStrictEqual(evaluation.physics.bam, run.provenance.bam)
      || !isDeepStrictEqual(evaluation.spec, { ...trial.recipe.evaluation, policyId: run.policyId })
      || Date.parse(evaluation.createdAt) < Date.parse(trial.createdAt)) throw new Error('Evaluation differs from the trial policy or frozen assessment')
    return run
  }
  private async readReflection(id: RobotReflectionId): Promise<RobotReflection> {
    identity(id, 'reflection')
    const value = row(await this.read(['learning', 'reflections', `${id}.json`]), ['version', 'id', 'createdAt', 'trialId', 'evaluationId', 'observation', 'interpretation', 'nextChange', 'trialSha256', 'runId', 'policyHash', 'reportSha256', 'sha256'])
    verify(value)
    if (value.id !== id) throw new Error('Reflection identity differs from filename')
    const { trialId, evaluationId, observation, interpretation, nextChange } = value
    validateRobotRequest({ operation: 'save_reflection', reflection: { trialId, evaluationId, observation, interpretation, nextChange } })
    const reflection = value as unknown as RobotReflection
    this.textBounds([reflection.observation, reflection.interpretation, reflection.nextChange])
    identity(reflection.runId, 'run'); checksum(reflection.trialSha256); checksum(reflection.policyHash); checksum(reflection.reportSha256)
    return reflection
  }
  /** Read reflection evidence and recheck all immutable references.
   * @param id - Reflection identity.
   * @returns Validated reflection, independent of current runtime compatibility.
   */
  async reflection(id: RobotReflectionId): Promise<RobotReflection> {
    const reflection = await this.readReflection(id)
    await this.checkReflection(reflection, new Set())
    return reflection
  }
  private async checkReflection(reflection: RobotReflection, ancestors: Set<RobotTrialId>): Promise<void> {
    const trial = await this.readTrial(reflection.trialId, ancestors)
    const evaluation = await this.evaluation(reflection.evaluationId)
    const run = await this.matchEvaluation(trial, evaluation)
    if (reflection.trialSha256 !== trial.sha256 || reflection.runId !== run.id || reflection.policyHash !== evaluation.policyHash
      || reflection.reportSha256 !== learningHash(evaluation) || Date.parse(reflection.createdAt) < Date.parse(evaluation.evaluatedAt)) throw new Error('Reflection evidence differs from its frozen references')
  }
  /** Append an observation bound to a completed evaluation.
   * @param request - Learner text and exact trial/evaluation identities.
   * @returns Newly committed immutable reflection.
   */
  async saveReflection(request: RobotReflectionRequest): Promise<RobotReflection> {
    validateRobotRequest({ operation: 'save_reflection', reflection: request })
    this.textBounds([request.observation, request.interpretation, request.nextChange])
    if ((await this.names(['learning', 'reflections'], this.limits.maxReflections, 'reflection', '.json')).length >= this.limits.maxReflections) throw new Error('Maximum saved reflections reached')
    const trial = await this.trial(request.trialId)
    const evaluation = await this.evaluation(request.evaluationId)
    const run = await this.matchEvaluation(trial, evaluation)
    if (Date.parse(evaluation.evaluatedAt) > Date.now()) throw new Error('Cannot reflect on a future-dated evaluation')
    const content = { ...request, version: 1 as const, id: `reflection-${randomUUID()}` as RobotReflectionId, createdAt: new Date().toISOString(),
      trialSha256: trial.sha256, runId: run.id, policyHash: evaluation.policyHash, reportSha256: learningHash(evaluation) }
    const reflection = { ...content, sha256: learningHash(content) }
    await this.create(['learning', 'reflections', `${reflection.id}.json`], reflection)
    return reflection
  }
  /** Read bounded immutable reflection history with validated evidence.
   * @returns Completed saved reflections.
   */
  async reflections(): Promise<RobotReflection[]> {
    const ids = await this.names(['learning', 'reflections'], this.limits.maxReflections, 'reflection', '.json')
    const result: RobotReflection[] = []
    for (const id of ids) result.push(await this.reflection(id as RobotReflectionId))
    return result
  }
}
