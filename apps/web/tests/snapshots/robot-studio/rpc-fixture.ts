/** Authored external Robot RPC replies; the assembled app retains all project and playback logic. */
import { expect } from 'vitest'
import type {
  RobotFrame, RobotLabRequest, RobotLabResult, RobotPolicy, RobotProfile,
  RobotProjectRecipe, RobotProjectRevision, RobotRun, RobotStudioCatalog, RobotTemplate,
  RobotEvaluation, RobotTrialEntry, RobotTrial, RobotReflection,
} from '@deepseek-ai/dsh-robot-lab/types'

const profile: RobotProfile = {
  id: 'microduck' as RobotProfile['id'], label: 'MicroDuck', modelSha256: '1'.repeat(64),
  rootBody: { name: 'base', index: 0 }, hardwareAvailable: false,
  joints: Array.from({ length: 14 }, (_, index) => ({ name: `joint_${index + 1}`, index,
    lower: -1, upper: 1, defaultPosition: 0, unit: 'rad' })),
}
const groove: RobotTemplate = {
  id: 'groove' as RobotTemplate['id'], version: 1, label: 'Gentle groove',
  description: 'A gentle authored dance target.', experimental: true, category: 'dance', difficulty: 'starter',
  behaviorId: 'dance', trainingWeights: { pose: 2 }, defaultParameters: { bpm: 120, beats: 8, moveSize: 0.5 },
}
const wave: RobotTemplate = { ...groove, id: 'wave' as RobotTemplate['id'], label: 'Small wave',
  description: 'An authored wave target.', category: 'action' }
const catalog: RobotStudioCatalog = {
  profiles: [profile], templates: [groove, wave],
  limits: { minBpm: 60, maxBpm: 180, beatChoices: [8, 16], blockBeatChoices: [4, 8],
    maxProjectBlocks: 4, maxClipSeconds: 30, maxClipKeys: 240 },
}
const recipe: RobotProjectRecipe = {
  projectId: null, name: '月光鸭 🦆', profileId: profile.id, templateId: groove.id, templateVersion: 1,
  parameters: { bpm: 120, beats: 8, moveSize: 0.5 },
  music: { version: 1, style: 'lofi', bpm: 120, beats: 8, seed: 1 },
  blocks: [{ templateId: groove.id, templateVersion: 1, beats: 4, moveSize: 1 },
    { templateId: wave.id, templateVersion: 1, beats: 4, moveSize: 0.75 }],
}
const revision: RobotProjectRevision = {
  version: 2, id: 'revision-1' as RobotProjectRevision['id'], projectId: 'project-1' as RobotProjectRevision['projectId'],
  createdAt: '2026-09-04T00:00:00.000Z', recipe, profile, template: groove,
  blocks: [{ template: groove, beats: 4, moveSize: 0.5 }, { template: wave, beats: 4, moveSize: 0.375 }],
  training: { behaviorId: 'dance', weights: { pose: 3, upright: 1 } },
  clip: { version: 1, name: recipe.name, duration: 4, loop: true,
    keys: [{ t: 0, joints: Array<number>(14).fill(0), rootPitch: 0 },
      { t: 2, joints: Array<number>(14).fill(0.2), rootPitch: 0.1 },
      { t: 4, joints: Array<number>(14).fill(0), rootPitch: 0 }] },
  sha256: '2'.repeat(64),
}
const newerRevision: RobotProjectRevision = {
  ...revision, id: 'revision-2' as RobotProjectRevision['id'], sha256: '3'.repeat(64),
  recipe: { ...recipe, projectId: revision.projectId, name: '新节拍 🌙',
    parameters: { ...recipe.parameters, bpm: 100 }, music: { ...recipe.music, bpm: 100 } },
  clip: { ...revision.clip, name: '新节拍 🌙', duration: 4.8,
    keys: [{ t: 0, joints: Array<number>(14).fill(0), rootPitch: 0 },
      { t: 2.4, joints: Array<number>(14).fill(0.2), rootPitch: 0.1 },
      { t: 4.8, joints: Array<number>(14).fill(0), rootPitch: 0 }] },
}
const bam = { source: 'fixture', parameters: {}, sha256: '4'.repeat(64) }
const physics = { actuator: 'bam' as const, bam, observationNoise: false as const,
  actionDelay: true as const, domainRandomization: false as const, randomYaw: false as const }
const policy: RobotPolicy = {
  id: 'run:fixture' as RobotPolicy['id'], runId: 'fixture-run' as RobotRun['id'], name: 'project-revision-1',
  sha256: '5'.repeat(64), observationProfile: 'microduck-lab-body-phase-61', verification: 'unverified',
  runtimeCompatibility: { available: true, reason: null }, deployment: { available: false, reason: 'Simulation prototype only.' },
}

function frames(reference: boolean): RobotFrame[] {
  return [0, 1, 2, 3, ...(reference ? [4] : [])].map((time, index) => ({
    step: index * 50, time, bodies: [[0, 0, 0.3, 1, 0, 0, 0]], reward: 0,
    terminated: !reference && time === 3,
    telemetry: {
      jointPosition: Array<number>(14).fill(time * 0.1),
      jointVelocity: reference ? null : Array<number>(14).fill(0.2),
      controllerTarget: reference ? null : Array<number>(14).fill(0.25),
      actuatorTorque: reference ? null : Array<number>(14).fill(0.3), rootBody: 'base',
      rootLinearVelocityWorld: reference ? null : [0.1, 0, 0], rootSpeed: reference ? null : 0.1, rootTilt: 0.05,
    },
  }))
}

/**
 * Create a bounded, in-memory external service script with captured wire requests.
 * @returns authored replies and the request log; unsupported operations fail rather than reaching a host.
 */
export function robotRpcFixture() {
  const requests: Array<{ sessionId: string; request: RobotLabRequest }> = []
  const projects: RobotProjectRevision[] = []
  const runs: RobotRun[] = []
  const policies: RobotPolicy[] = []
  const trials: RobotTrialEntry[] = []
  const evaluations: RobotEvaluation[] = []
  const reflections: RobotReflection[] = []
  const available = { available: true, reason: null }
  const respond = (request: RobotLabRequest): RobotLabResult => {
    switch (request.operation) {
      case 'readiness': return { operation: request.operation, readiness: {
        ready: true, reason: null, defaultBackend: 'cpu', versions: {},
        backends: { cpu: { ...available, learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
          mlx: { available: false, reason: 'MLX is unavailable in this fixture.', learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} } },
        capabilities: { train: available, simulate: available, evaluate: available,
          deploy: { available: false, reason: 'Simulation prototype only.' } },
      } }
      case 'studio': return { operation: request.operation, catalog }
      case 'projects': return { operation: request.operation, projects }
      case 'behaviors': return { operation: request.operation, behaviors: [{ id: 'dance', label: 'Dance tracking',
        description: 'Track the authored target in simulation.', defaultSteps: 4096,
        terms: [{ key: 'pose', label: 'Pose', weight: 1, penalty: false }, { key: 'upright', label: 'Upright', weight: 1, penalty: false }] }] }
      case 'policies': return { operation: request.operation, policies }
      case 'runs': return { operation: request.operation, runs, incompatibleRuns: [] }
      case 'trials': return { operation: request.operation, trials }
      case 'evaluations': return { operation: request.operation, evaluations, incompleteCount: 0 }
      case 'reflections': return { operation: request.operation, reflections }
      case 'project': {
        const project = projects.find(item => item.id === request.projectRevisionId)
        if (project === undefined) throw new Error('Fixture project does not exist')
        return { operation: request.operation, project }
      }
      case 'scene': return { operation: request.operation, scene: { bodies: ['base'], meshes: [], geoms: [],
        defaultJoints: Array<number>(14).fill(0), jointNames: profile.joints.map(joint => joint.name) } }
      case 'save_project': {
        const project = projects.length === 0 ? revision : newerRevision
        expect(request.recipe).toEqual(project.recipe)
        projects.push(project)
        return { operation: request.operation, project }
      }
      case 'reference_preview':
        expect(request.projectRevisionId).toBe(revision.id)
        return { operation: request.operation, preview: { mode: 'kinematic-reference', projectRevisionId: revision.id,
          projectSha256: revision.sha256, controlHz: 50, frames: frames(true), limitations: ['Not physics-tested.'] } }
      case 'save_trial': {
        const project = trials.length === 0 ? revision : newerRevision
        expect(trials.length).toBeLessThan(2)
        expect(request.recipe.spec).toEqual({ projectRevisionId: project.id, name: `project-${project.id}`,
          behaviorId: 'dance', backend: 'cpu', steps: 1024, envs: 4, seed: 0,
          actuator: 'bam', weights: { pose: 3, upright: 1 }, clip: null })
        expect(request.recipe.parentReflectionId).toBe(trials.length === 0 ? null : reflections[0]?.id)
        const trial: RobotTrial = { version: 1, id: `trial-${trials.length + 1}` as RobotTrial['id'],
          createdAt: trials.length === 0 ? '2026-09-05T00:00:00.000Z' : '2026-09-05T00:03:00.000Z',
          projectRevisionId: project.id, projectSha256: project.sha256,
          recipe: structuredClone(request.recipe), sha256: (trials.length === 0 ? 'a' : 'b').repeat(64) }
        trials.push({ trial, binding: null, run: null })
        return { operation: request.operation, trial }
      }
      case 'train_trial': {
        const entry = trials.find(item => item.trial.id === request.trialId)
        if (entry === undefined || entry.run !== null) throw new Error('Fixture trial is missing or already trained')
        const project = projects.find(item => item.id === entry.trial.projectRevisionId)
        if (project === undefined) throw new Error('Fixture trial target is missing')
        const nextPolicy: RobotPolicy = runs.length === 0 ? policy : { ...policy,
          id: 'run:fixture-child' as RobotPolicy['id'], runId: 'fixture-child-run' as RobotRun['id'],
          name: 'project-revision-2', sha256: 'c'.repeat(64) }
        if (nextPolicy.runId === null) throw new Error('Fixture policy has no training run')
        const run: RobotRun = {
          formatVersion: 3, id: nextPolicy.runId, state: 'completed',
          spec: { ...entry.trial.recipe.spec, backend: 'cpu', clip: project.clip, projectSnapshot: project },
          provenance: { trainer: { backend: 'cpu', learnerDevice: 'cpu', physicsDevice: 'cpu',
            pythonVersion: '3.12', platform: 'fixture', architecture: 'fixture', hardware: 'fixture',
            dependencyVersions: {}, helperSha256: {}, recipe: {}, sha256: '6'.repeat(64) }, bam,
          bridgeSha256: '7'.repeat(64), dependencyVersions: {}, environment: { domainRandomization: false,
            randomYaw: false, standingSpawns: true, assistance: false, updateDevice: 'cpu', observationNoise: true, actionDelay: true } },
          createdAt: entry.trial.createdAt,
          finishedAt: runs.length === 0 ? '2026-09-05T00:00:10.000Z' : '2026-09-05T00:03:10.000Z',
          observationProfile: policy.observationProfile, recipeHash: '8'.repeat(64), sourceFingerprint: '9'.repeat(64),
          progress: { steps: 1024, total: 1024, elapsedSeconds: 10, reward: 1 }, error: null,
          policyId: nextPolicy.id, policySha256: nextPolicy.sha256,
        }
        const binding = { version: 1 as const, trialId: entry.trial.id, trialSha256: entry.trial.sha256,
          runId: run.id, recipeHash: run.recipeHash, createdAt: run.createdAt, sha256: 'd'.repeat(64) }
        entry.run = run; entry.binding = binding; runs.push(run); policies.push(nextPolicy)
        return { operation: request.operation, trial: entry.trial, binding, run }
      }
      case 'evaluate_trial': {
        const entry = trials.find(item => item.trial.id === request.trialId)
        const assessed = policies.find(item => item.id === entry?.run?.policyId)
        if (entry === undefined || assessed === undefined) throw new Error('Fixture trial has no policy')
        const first = entry.trial.id === trials[0]?.trial.id
        const spec = { ...entry.trial.recipe.evaluation, policyId: assessed.id }
        const evaluation: RobotEvaluation = {
          id: `evaluation-${evaluations.length + 1}` as RobotEvaluation['id'],
          createdAt: first ? '2026-09-05T00:01:00.000Z' : '2026-09-05T00:04:00.000Z',
          evaluatedAt: first ? '2026-09-05T00:01:10.000Z' : '2026-09-05T00:04:10.000Z',
          physics, policyId: assessed.id, policyHash: assessed.sha256, spec,
          observationProfile: assessed.observationProfile, passed: !first,
          episodes: Array.from({ length: spec.episodes }, (_, index) => ({ seed: spec.seed + index,
            steps: first && index === 0 ? 150 : spec.stepsPerEpisode, terminated: first && index === 0,
            reward: first ? 0.3 : 0.9, uprightFraction: first ? 0.6 : 0.98,
            poseRmse: first ? 0.25 : 0.1, bamSettings: {} })),
          limitations: ['Choreography completion is not assessed.', 'Robustness is not assessed.', 'Not hardware certification.'],
        }
        evaluations.push(evaluation)
        return { operation: request.operation, evaluation }
      }
      case 'save_reflection': {
        const entry = trials.find(item => item.trial.id === request.reflection.trialId)
        const evaluation = evaluations.find(item => item.id === request.reflection.evaluationId)
        if (entry?.run === null || entry?.run === undefined || evaluation === undefined
          || entry.run.policyId !== evaluation.policyId || entry.run.policySha256 !== evaluation.policyHash) {
          throw new Error('Fixture reflection does not match the completed trial assessment')
        }
        const reflection: RobotReflection = { ...request.reflection, version: 1,
          id: 'reflection-1' as RobotReflection['id'], createdAt: '2026-09-05T00:02:00.000Z',
          trialSha256: entry.trial.sha256, runId: entry.run.id, policyHash: evaluation.policyHash,
          reportSha256: 'e'.repeat(64), sha256: 'f'.repeat(64) }
        reflections.push(reflection)
        return { operation: request.operation, reflection }
      }
      case 'replay_evaluation': {
        const evaluation = evaluations.find(item => item.id === request.evaluationId)
        if (evaluation === undefined || evaluation.episodes[request.episodeIndex] === undefined) {
          throw new Error('Fixture evaluation episode does not exist')
        }
        return { operation: request.operation, evaluationId: evaluation.id, episodeIndex: request.episodeIndex,
          mode: 'new-resimulation', simulation: { mode: 'recorded-simulation', policyId: evaluation.policyId,
            policyHash: evaluation.policyHash, observationProfile: evaluation.observationProfile,
            controlHz: 50, physics: evaluation.physics, bamSettings: {}, frames: frames(false) } }
      }
      case 'simulate': {
        const selected = policies.find(item => item.id === request.policyId)
        if (selected === undefined) throw new Error('Fixture policy does not exist')
        expect(request).toEqual({ operation: 'simulate', policyId: selected.id, steps: 200, seed: 0, command: [0, 0, 0] })
        return { operation: request.operation, simulation: { mode: 'recorded-simulation', policyId: selected.id,
          policyHash: selected.sha256, observationProfile: selected.observationProfile, controlHz: 50, physics,
          bamSettings: {}, frames: frames(false) } }
      }
      case 'prepare': return { operation: request.operation, policyId: policy.id, allowed: false,
        reasons: ['Simulation prototype only.', 'No hardware activation API.'] }
      default: throw new Error(`Robot snapshot has no authored reply for ${request.operation}`)
    }
  }
  return {
    requests,
    history: () => structuredClone({ trials, evaluations, reflections }),
    /** Make a separately authored assessment visible on the next external history read. */
    publishExploratoryEvaluation: () => {
      const source = evaluations[1]
      if (source === undefined) throw new Error('Fixture child assessment is missing')
      const evaluation: RobotEvaluation = { ...structuredClone(source),
        id: 'evaluation-exploratory' as RobotEvaluation['id'],
        spec: { ...source.spec, stepsPerEpisode: 250 },
        episodes: source.episodes.map(episode => ({ ...episode, steps: 250 })),
        createdAt: '2026-09-05T00:05:00.000Z', evaluatedAt: '2026-09-05T00:05:10.000Z' }
      evaluations.push(evaluation)
      return structuredClone(evaluation)
    },
    respond: (sessionId: string, input: unknown): RobotLabResult => {
      // The fixture transport receives JSON; domain tests retain the typed Robot API.
      const request = structuredClone(input) as RobotLabRequest
      expect(sessionId).toBe('fx-alpha')
      requests.push({ sessionId, request })
      return structuredClone(respond(request))
    },
  }
}
