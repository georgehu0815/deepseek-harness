/** Session-owned Robot Lab data and request lifecycle; this module has no React dependency. */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  RobotBehavior, RobotEvaluation, RobotLabRequest, RobotLabResult, RobotPolicy,
  RobotReadiness, RobotRun, RobotScene, RobotSimulation, RobotStudioCatalog, RobotProjectRevision,
  RobotProjectRecipe, RobotReferencePreview, RobotMusicRecipe, RobotTrial, RobotTrialEntry, RobotTrialRecipe,
  RobotReflection, RobotReflectionRequest, RobotEvaluationId,
} from '@deepseek-ai/dsh-robot-lab/types'

import type { DuckMember, GroupRecording, GroupTrack } from './group-playback.ts'
import { sameBam } from './evaluation-evidence.ts'

/** Injected authenticated transport; the captured session is never inferred from current UI selection. */
export type LabTransport = (sessionId: SessionId, request: RobotLabRequest) => Promise<RobotLabResult>

/** A target preview and a learned-policy recording retain distinct provenance. */
export type StudioRecording = RobotSimulation | RobotReferencePreview

/** Immutable business snapshot consumed through the framework's injected hook. */
export interface LabSnapshot {
  catalog: RobotStudioCatalog | null
  projects: RobotProjectRevision[]
  project: RobotProjectRevision | null
  recording: StudioRecording | null
  groupRecording: GroupRecording | null
  recordingProject: RobotProjectRevision | null
  readiness: RobotReadiness | null
  behaviors: RobotBehavior[]
  policies: RobotPolicy[]
  runs: RobotRun[]
  incompatibleRuns: Extract<RobotLabResult, { operation: 'runs' }>['incompatibleRuns']
  scene: RobotScene | null
  evaluation: RobotEvaluation | null
  evaluations: RobotEvaluation[]
  incompleteEvaluations: number
  trials: RobotTrialEntry[]
  reflections: RobotReflection[]
  recordingEvaluation: { evaluationId: RobotEvaluationId; episodeIndex: number } | null
  busy: string | null
  error: string | null
  deploymentReasons: string[]
}

/**
 * Construct disconnected state without claiming environment readiness.
 * @returns a fresh initial snapshot.
 */
export function emptyLabSnapshot(): LabSnapshot {
  return {
    readiness: null, behaviors: [], policies: [], runs: [], incompatibleRuns: [], scene: null,
    evaluation: null, evaluations: [], incompleteEvaluations: 0, trials: [], reflections: [], recordingEvaluation: null,
    busy: null, error: null, deploymentReasons: [],
    catalog: null, projects: [], project: null, recording: null, groupRecording: null, recordingProject: null,
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Robot Lab result: ${JSON.stringify(value)}`)
}

/** Owns requests and progress refresh for one session, independently of panel mounting. */
export class LabClient {
  #snapshot = emptyLabSnapshot()
  #listeners = new Set<() => void>()
  #disposed = false
  #timer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param sessionId - immutable request owner.
   * @param transport - authenticated Remote callback.
   * @param pollMs - configured active-run refresh interval.
   * @param loadRecording - initialize the shared transport before publication; groups supply their shorter duration as the third argument.
   */
  constructor(readonly sessionId: SessionId, private readonly transport: LabTransport, private readonly pollMs: number,
    private readonly loadRecording: (
      recording: StudioRecording, music: RobotMusicRecipe | null, durationOverride?: number,
    ) => void = () => {}) {}

  /**
   * Read the current committed session data without subscribing.
   * @returns the same snapshot reference until an operation changes it.
   */
  getSnapshot = (): LabSnapshot => this.#snapshot

  /**
   * Subscribe to committed data changes.
   * @param listener - framework notification callback.
   * @returns the listener disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    if (this.#isDisposed()) return () => {}
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Reload history and readiness independently, preserving committed data and reporting every failed read after settlement. */
  async refresh(): Promise<void> {
    await this.#run('refresh', async () => {
      const metadata = ['trials', 'evaluations', 'reflections', 'readiness'] as const
      const scientific = ['studio', 'projects', 'behaviors', 'policies', 'runs', 'scene'] as const
      const errors: string[] = []
      const settle = async (operation: typeof metadata[number] | typeof scientific[number]) => {
        try { return await this.#request({ operation }) }
        catch (error) {
          errors.push(`${operation}: ${error instanceof Error ? error.message : String(error)}`)
          return null
        }
      }
      const results = await Promise.all(metadata.map(settle))
      if (this.#isDisposed()) return
      if (results.some(result => result?.operation === 'readiness' && result.readiness.ready)) {
        for (const operation of scientific) {
          if (this.#isDisposed()) return
          await settle(operation)
        }
      }
      if (errors.length > 0) throw new Error(errors.join('\n'))
    })
  }

  /**
   * Execute a user action; errors are published, never converted into success.
   * @param request - finite backend operation.
   * @returns its committed result, or null when admission failed or the owner was disposed.
   */
  async execute(request: RobotLabRequest): Promise<RobotLabResult | null> {
    let result: RobotLabResult | null = null
    await this.#run(request.operation, async () => {
      result = await this.#request(request)
      if (request.operation === 'train' || request.operation === 'train_trial' || request.operation === 'stop'
        || request.operation === 'evaluate' || request.operation === 'evaluate_trial') {
        await this.#request({ operation: 'policies' })
      }
    })
    return this.#isDisposed() ? null : result
  }

  /**
   * Record policies independently, then share one clock and the first duck’s frozen project soundtrack without retiming policies.
   * Failures and disposal preserve the loaded recording; busy clients do not admit another operation.
   * @param members - duck selections and placements copied at the gesture, before listeners or requests run.
   * @param steps - requested horizon for each independent simulation.
   * @param seed - deterministic reset seed shared by the independent simulations.
   * @returns after atomic publication or a visible operation error; disposal suppresses late results.
   */
  async simulateGroup(members: DuckMember[], steps: number, seed: number): Promise<void> {
    const captured = members.map(member => ({ ...member }))
    const policies = this.#snapshot.policies.map(policy => ({ id: policy.id, sha256: policy.sha256,
      available: policy.runtimeCompatibility.available }))
    const runs = this.#snapshot.runs
    await this.#run('simulate_group', async () => {
      const selections = captured.map((member) => {
        const policy = policies.find(item => item.id === member.policyId)
        const label = `${member.name} (${member.id})`
        if (policy === undefined || !policy.available) throw new Error(`${label}: Select an available policy.`)
        return { member, policy, label }
      })
      const tracks: GroupTrack[] = []
      let shortestDuration = Infinity
      for (const { member, policy, label } of selections) {
        if (this.#isDisposed()) return
        let result: RobotLabResult
        try {
          result = await this.transport(this.sessionId, { operation: 'simulate', policyId: policy.id,
            steps, seed, command: [0, 0, 0] })
        } catch (error) {
          throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
        }
        if (this.#isDisposed()) return
        if (result.operation !== 'simulate') throw new Error(`${label}: Robot Lab response mismatch: simulate / ${result.operation}`)
        const simulation = result.simulation
        if (simulation.policyId !== policy.id || simulation.policyHash !== policy.sha256) {
          throw new Error(`${label}: The recording does not match the selected policy.`)
        }
        const duration = simulation.frames.at(-1)?.time
        if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
          throw new Error(`${label}: The recording has no playable duration.`)
        }
        shortestDuration = Math.min(shortestDuration, duration)
        tracks.push({ member, simulation })
      }
      const first = tracks[0]?.simulation
      if (first === undefined) throw new Error('Select at least one duck for group playback.')
      const groupRecording: GroupRecording = { tracks, duration: shortestDuration }
      const run = runs.find(item => item.policyId === first.policyId && item.policySha256 === first.policyHash)
      const project = run?.spec.projectSnapshot ?? null
      this.loadRecording(first, project?.recipe.music ?? null, groupRecording.duration)
      this.#publish({ groupRecording, recording: first, recordingProject: project, recordingEvaluation: null })
    })
  }

  /**
   * Save an immutable revision and optionally render that exact target through MuJoCo forward kinematics.
   * @param recipe - the user's complete draft captured at the gesture.
   * @param preview - whether to prepare the saved revision's explicitly non-physics preview.
   * @returns the committed revision, or null when admission/save did not complete.
   */
  async saveProject(recipe: RobotProjectRecipe, preview: boolean): Promise<RobotProjectRevision | null> {
    let saved: RobotProjectRevision | null = null
    await this.#run(preview ? 'reference_preview' : 'save_project', async () => {
      await this.#request({ operation: 'save_project', recipe })
      if (this.#isDisposed()) return
      const project = this.#snapshot.project
      saved = project
      if (preview && project !== null) {
        await this.#request({ operation: 'reference_preview', projectRevisionId: project.id })
      }
    })
    return this.#isDisposed() ? null : saved
  }

  /**
   * Commit a trial before optionally starting its one owned run; a failed start preserves the saved trial.
   * @param recipe - complete pre-training plan and frozen assessment settings.
   * @param start - whether to admit training after the save commits.
   * @returns the committed trial, or null when save was denied, failed, or disposed.
   */
  async saveTrial(recipe: RobotTrialRecipe, start: boolean): Promise<RobotTrial | null> {
    let saved: RobotTrial | null = null
    await this.#run(start ? 'save_and_train_trial' : 'save_trial', async () => {
      const result = await this.#request({ operation: 'save_trial', recipe })
      if (result?.operation !== 'save_trial') return
      saved = result.trial
      if (start) {
        await this.#request({ operation: 'train_trial', trialId: result.trial.id })
        await this.#request({ operation: 'policies' })
      }
    })
    return this.#isDisposed() ? null : saved
  }

  /**
   * Persist interpretation without changing the report or creating another trial.
   * @param reflection - explicit trial/report references and student-authored text.
   * @returns the committed reflection, or null when no save committed.
   */
  async saveReflection(reflection: RobotReflectionRequest): Promise<RobotReflection | null> {
    let saved: RobotReflection | null = null
    await this.#run('save_reflection', async () => {
      const result = await this.#request({ operation: 'save_reflection', reflection })
      if (result?.operation === 'save_reflection') saved = result.reflection
    })
    return this.#isDisposed() ? null : saved
  }

  /**
   * Resolve the parent's exact project before opening an explicitly unsaved improvement draft.
   * @param reflection - committed reflection selected from session history.
   * @returns parent trial and project, or null on unavailable/mismatched source or disposal.
   */
  async improvementSource(reflection: RobotReflection): Promise<{ trial: RobotTrial; project: RobotProjectRevision } | null> {
    let source: { trial: RobotTrial; project: RobotProjectRevision } | null = null
    await this.#run('improvement_source', async () => {
      const entry = this.#snapshot.trials.find(item => item.trial.id === reflection.trialId && item.trial.sha256 === reflection.trialSha256)
      if (entry === undefined) throw new Error('The reflection’s exact parent trial is not loaded. Refresh learning history.')
      let project = entry.run?.spec.projectSnapshot ?? this.#snapshot.projects.find(item => item.id === entry.trial.projectRevisionId)
      if (project === undefined) {
        const result = await this.#request({ operation: 'project', projectRevisionId: entry.trial.projectRevisionId })
        if (result?.operation === 'project') project = result.project
      }
      if (project === undefined || project.id !== entry.trial.projectRevisionId || project.sha256 !== entry.trial.projectSha256) {
        throw new Error('The parent trial’s exact saved project is unavailable; no improvement draft was created.')
      }
      source = { trial: entry.trial, project }
    })
    return this.#isDisposed() ? null : source
  }

  /**
   * Run a bounded local asset action through the same visible operation/error lifecycle.
   * @param label - user-visible action name.
   * @param work - local generation or download callback.
   */
  async localAction(label: string, work: () => void): Promise<void> { await this.#run(label, work) }

  /** Detach consumers and polling; this does not stop server-owned training. */
  dispose(): void {
    this.#disposed = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#listeners.clear()
  }

  #isDisposed(): boolean { return this.#disposed }

  async #run(label: string, work: () => void | Promise<void>): Promise<void> {
    if (this.#isDisposed() || this.#snapshot.busy !== null) return
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#publish({ busy: label, error: null })
    try { await work() }
    catch (error) { this.#publish({ error: error instanceof Error ? error.message : String(error) }) }
    finally {
      this.#publish({ busy: null })
      if (!this.#isDisposed() && this.#snapshot.runs.some(run => run.state === 'starting' || run.state === 'running')) {
        this.#timer = setTimeout(() => { void this.execute({ operation: 'runs' }) }, this.pollMs)
      }
    }
  }

  async #request(request: RobotLabRequest): Promise<RobotLabResult | null> {
    if (this.#isDisposed()) return null
    const result = await this.transport(this.sessionId, request)
    if (this.#isDisposed()) return null
    if (result.operation !== request.operation) throw new Error(`Robot Lab response mismatch: ${request.operation} / ${result.operation}`)
    switch (result.operation) {
      case 'trials': this.#publish({ trials: result.trials }); break
      case 'save_trial':
        this.#publish({ trials: [{ trial: result.trial, binding: null, run: null },
          ...this.#snapshot.trials.filter(item => item.trial.id !== result.trial.id)] })
        break
      case 'train_trial':
        this.#publish({
          trials: [{ trial: result.trial, binding: result.binding, run: result.run },
            ...this.#snapshot.trials.filter(item => item.trial.id !== result.trial.id)],
          runs: [result.run, ...this.#snapshot.runs.filter(run => run.id !== result.run.id)],
        })
        break
      case 'evaluations': this.#publish({ evaluations: result.evaluations, incompleteEvaluations: result.incompleteCount }); break
      case 'reflections': this.#publish({ reflections: result.reflections }); break
      case 'save_reflection':
        this.#publish({ reflections: [result.reflection, ...this.#snapshot.reflections.filter(item => item.id !== result.reflection.id)] })
        break
      case 'studio': this.#publish({ catalog: result.catalog }); break
      case 'projects': this.#publish({ projects: result.projects }); break
      case 'save_project': case 'project':
        this.#publish({ project: result.project,
          projects: [result.project, ...this.#snapshot.projects.filter(item => item.id !== result.project.id)] })
        break
      case 'reference_preview': {
        const project = this.#snapshot.projects.find(item => item.id === result.preview.projectRevisionId)
        if (project === undefined || project.sha256 !== result.preview.projectSha256) throw new Error('Reference preview does not match a loaded project revision.')
        this.loadRecording(result.preview, project.recipe.music)
        this.#publish({ recording: result.preview, groupRecording: null, recordingProject: project, recordingEvaluation: null })
        break
      }
      case 'readiness': this.#publish({ readiness: result.readiness }); break
      case 'behaviors': this.#publish({ behaviors: result.behaviors }); break
      case 'policies': this.#publish({ policies: result.policies }); break
      case 'runs': {
        const finished = this.#snapshot.runs.some(run => (run.state === 'starting' || run.state === 'running')
          && result.runs.some(next => next.id === run.id && next.state === 'completed'))
        this.#publish({ runs: result.runs, incompatibleRuns: result.incompatibleRuns,
          trials: this.#snapshot.trials.map(entry => ({ ...entry,
            run: result.runs.find(run => run.id === entry.binding?.runId) ?? entry.run })) })
        if (finished) await this.#request({ operation: 'policies' })
        break
      }
      case 'scene': this.#publish({ scene: result.scene }); break
      case 'replay_evaluation': case 'simulate': {
        if (result.operation === 'replay_evaluation') {
          const report = this.#snapshot.evaluations.find(item => item.id === result.evaluationId)
          if (request.operation !== 'replay_evaluation' || request.evaluationId !== result.evaluationId
            || request.episodeIndex !== result.episodeIndex || report === undefined || report.episodes[result.episodeIndex] === undefined
            || report.policyId !== result.simulation.policyId || report.policyHash !== result.simulation.policyHash
            || report.observationProfile !== result.simulation.observationProfile
            || !sameBam(report.physics.bam, result.simulation.physics.bam)) {
            throw new Error('Episode re-simulation does not match the requested recorded evaluation.')
          }
        }
        const run = this.#snapshot.runs.find(item => item.policyId === result.simulation.policyId
          && item.policySha256 === result.simulation.policyHash)
        const project = run?.spec.projectSnapshot ?? null
        this.loadRecording(result.simulation, project?.recipe.music ?? null)
        this.#publish({ recording: result.simulation, groupRecording: null, recordingProject: project,
          recordingEvaluation: result.operation === 'replay_evaluation' ? { evaluationId: result.evaluationId, episodeIndex: result.episodeIndex } : null })
        break
      }
      case 'evaluate_trial': case 'evaluate':
        this.#publish({ evaluation: result.evaluation,
          evaluations: [result.evaluation, ...this.#snapshot.evaluations.filter(item => item.id !== result.evaluation.id)] })
        break
      case 'prepare': this.#publish({ deploymentReasons: result.reasons }); break
      case 'run': case 'train': case 'stop':
        this.#publish({ runs: [result.run, ...this.#snapshot.runs.filter(run => run.id !== result.run.id)],
          trials: this.#snapshot.trials.map(entry => entry.binding?.runId === result.run.id ? { ...entry, run: result.run } : entry) })
        break
      default: assertNever(result)
    }
    return result
  }

  #publish(change: Partial<LabSnapshot>): void {
    if (this.#isDisposed()) return
    this.#snapshot = { ...this.#snapshot, ...change }
    for (const listener of this.#listeners) {
      try { listener() }
      catch (error) { console.error('Robot Lab subscriber failed', error) }
    }
  }
}
