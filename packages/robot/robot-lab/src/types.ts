/** JSON records shared by Robot Lab tools, providers, and browser remotes. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** JSON value carried in provenance recipes across the browser remote; bare `unknown` cannot cross a Typert boundary. */
export type RobotJsonValue =
  | null
  | boolean
  | number
  | string
  | RobotJsonValue[]
  | { [key: string]: RobotJsonValue }

/** Immutable experiment identity. */
export type RobotRunId = string & Branded<'RobotRunId'>
/** Policy identity resolved inside the configured Lab or owned run storage. */
export type RobotPolicyId = string & Branded<'RobotPolicyId'>
/** Immutable evaluation admission and report identity. */
export type RobotEvaluationId = string & Branded<'RobotEvaluationId'>
/** Effective optional-package or fallback BAM values, hashed together with their source. */
export interface RobotBamProvenance { source: string; parameters: Record<string, number>; sha256: string }
/** Recorded rollout physics; seeded startup BAM samples are recorded separately. */
export interface RobotPhysics {
  actuator: 'bam'
  bam: RobotBamProvenance
  observationNoise: false
  actionDelay: true
  domainRandomization: false
  randomYaw: false
}
/** Exact command semantics, not merely ONNX tensor dimensions. */
export type ObservationProfile = 'microduck-standard-61' | 'microduck-lab-body-phase-61'
/** Availability of one operation with an actionable explanation when disabled. */
export interface RobotCapability { available: boolean; reason: string | null }
/** Explicit local learner; MuJoCo physics remains on the CPU. */
export type RobotTrainingBackend = 'cpu' | 'mlx'
/** Optional learner availability, independent of CPU simulation and evaluation. */
export interface RobotTrainingBackendReadiness extends RobotCapability {
  learnerDevice: 'cpu' | 'metal'
  physicsDevice: 'cpu'
  versions: Record<string, string>
}
/** Environment discovery never claims training or hardware verification. */
export interface RobotReadiness {
  defaultBackend: 'cpu'
  backends: Record<RobotTrainingBackend, RobotTrainingBackendReadiness>
  ready: boolean
  reason: string | null
  versions: Record<string, string>
  capabilities: Record<'train' | 'simulate' | 'evaluate' | 'deploy', RobotCapability>
}
/** Authored reference motion; joint targets use the Lab's fourteen-joint order. */
export interface RobotClip {
  version: 1
  name: string
  duration: number
  loop: boolean
  keys: Array<{ t: number; joints: number[]; rootPitch: number }>
}
/** Installed robot adapter identity; the catalog lists only available model adapters. */
export type RobotProfileId = string & Branded<'RobotProfileId'>
/** Versioned authored motion identity, not a trained skill. */
export type RobotTemplateId = string & Branded<'RobotTemplateId'>
/** Immutable saved project revision identity. */
export type RobotProjectRevisionId = string & Branded<'RobotProjectRevisionId'>
/** Stable project identity shared by independently saved immutable revisions. */
export type RobotProjectId = string & Branded<'RobotProjectId'>
/** Browser-synthesized audio recipe; no audio provider or audio bytes are persisted. */
export interface RobotMusicRecipe {
  version: 1
  style: 'disco' | 'electronic' | 'lofi' | 'chiptune'
  bpm: number
  beats: number
  seed: number
}
/** Actual MJCF model metadata in the clip's fourteen-joint order. */
export interface RobotProfile {
  id: RobotProfileId
  label: string
  modelSha256: string
  rootBody: { name: string; index: number }
  joints: Array<{ name: string; index: number; lower: number; upper: number; defaultPosition: number; unit: 'rad' }>
  hardwareAvailable: false
}
/** Explicit authored motion parameters; moveSize is bounded to [0,1]. */
export interface RobotStudioParameters { bpm: number; beats: number; moveSize: number }
/** Curated experimental motion; availability never asserts learned execution quality. */
export interface RobotTemplate {
  id: RobotTemplateId
  version: 1
  label: string
  description: string
  experimental: true
  category: 'dance' | 'action'
  /** Authoring guidance, not measured policy competence. */
  difficulty: 'starter' | 'intermediate' | 'advanced'
  /** Registered reward behavior; use the behaviors catalog for terms and training steps. */
  behaviorId: string
  /** Explicit curated reward overrides; callers merge them with registered behavior defaults. */
  trainingWeights: Record<string, number>
  defaultParameters: RobotStudioParameters
}
/** Available model and template data, independent of optional MLX readiness. */
export interface RobotStudioCatalog {
  profiles: RobotProfile[]
  templates: RobotTemplate[]
  limits: {
    minBpm: number
    maxBpm: number
    beatChoices: number[]
    blockBeatChoices: number[]
    maxProjectBlocks: number
    maxClipSeconds: number
    maxClipKeys: number
  }
}
/** Ordered authored motion block; beats use the project's BPM and moveSize is in [0,1]. */
export interface RobotMotionBlock {
  templateId: RobotTemplateId
  templateVersion: 1
  beats: number
  moveSize: number
}
/** Frozen effective block; moveSize includes the project's master move-size multiplier. */
export interface RobotProjectBlock { template: RobotTemplate; beats: number; moveSize: number }
/** Backend-resolved reward recommendation for the whole compiled motion. */
export interface RobotProjectTraining { behaviorId: string; weights: Record<string, number> }
/** Save creates a new immutable revision; projectId null creates a new project. */
export interface RobotProjectRecipe {
  projectId: RobotProjectId | null
  /** Exact Unicode display text, not a path or internal training identifier. */
  name: string
  profileId: RobotProfileId
  templateId: RobotTemplateId
  templateVersion: 1
  /** Shared BPM, total beats and master move size; the latter multiplies each authored block's size. */
  parameters: RobotStudioParameters
  music: RobotMusicRecipe
  /** When present, ordered motion source whose first block must match the top-level template and version. */
  blocks?: RobotMotionBlock[]
}
/** Complete frozen project data, content-hashed before publication. */
export interface RobotProjectRevision {
  version: 2
  id: RobotProjectRevisionId
  projectId: RobotProjectId
  createdAt: string
  recipe: RobotProjectRecipe
  profile: RobotProfile
  /** First block's frozen template; use training for the whole-motion reward recommendation. */
  template: RobotTemplate
  blocks: RobotProjectBlock[]
  training: RobotProjectTraining
  /** Compiled targets whose name preserves the recipe's exact Unicode display text. */
  clip: RobotClip
  sha256: string
}
/** Kinematic pose or recorded simulation measurements; unavailable reference channels are null. */
export interface RobotTelemetry {
  /** Posed reference or recorded simulation qpos in radians, in profile joint order. */
  jointPosition: number[]
  /** Recorded MuJoCo qvel in radians/second, in profile joint order; null for kinematic previews. */
  jointVelocity: number[] | null
  /** MuJoCo ctrl position targets in radians after environment delay; excludes BAM bus receipt timing; null for kinematic previews. */
  controllerTarget: number[] | null
  /** Applied BAM plus XML generalized actuator torque at hinge DOFs in N m; null for kinematic previews. */
  actuatorTorque: number[] | null
  rootBody: string
  /** Recorded root body world linear velocity in m/s, ordered xyz; null for kinematic previews. */
  rootLinearVelocityWorld: number[] | null
  /** Recorded magnitude of rootLinearVelocityWorld in m/s; null for kinematic previews. */
  rootSpeed: number | null
  /** Angle between the root body's positive z axis and world up, in radians. */
  rootTilt: number
}
/** Kinematic MuJoCo forward poses, not learned-policy or dynamically feasible motion. */
export interface RobotReferencePreview {
  mode: 'kinematic-reference'
  projectRevisionId: RobotProjectRevisionId
  projectSha256: string
  controlHz: 50
  frames: RobotFrame[]
  limitations: string[]
}
/** Admission request; omitting backend explicitly resolves to CPU. */
export interface RobotTrainingRequest {
  /** Resolve this immutable revision at admission; null clip selects its saved clip, otherwise the clips must match. */
  projectRevisionId?: RobotProjectRevisionId
  backend?: RobotTrainingBackend
  name: string
  behaviorId: string
  steps: number
  envs: number
  seed: number
  actuator: 'bam' | 'xml'
  weights: Record<string, number>
  clip: RobotClip | null
}
/** Frozen training request with an explicit learner selection. */
export interface RobotTrainingSpec extends RobotTrainingRequest {
  backend: RobotTrainingBackend
  /** Present only for project-bound admission; no mutable project lookup during training. */
  projectSnapshot?: RobotProjectRevision
}
/** Frozen learner implementation and numerical recipe, separate from inference requirements. */
export interface RobotTrainerProvenance {
  backend: RobotTrainingBackend
  learnerDevice: 'cpu' | 'metal'
  physicsDevice: 'cpu'
  pythonVersion: string
  platform: string
  architecture: string
  hardware: string
  dependencyVersions: Record<string, string>
  helperSha256: Record<string, string>
  recipe: Record<string, RobotJsonValue>
  sha256: string
}
/** A catalog entry backed by registered Python reward functions. */
export interface RobotBehavior {
  id: string
  label: string
  description: string
  defaultSteps: number
  terms: Array<{ key: string; label: string; weight: number; penalty: boolean }>
}
/** Frozen physics/runtime and learner requirements for a supported run. */
export interface RobotRunProvenance {
  trainer: RobotTrainerProvenance
  bam: RobotBamProvenance
  bridgeSha256: string
  dependencyVersions: Record<string, string>
  environment: { domainRandomization: false; randomYaw: false; standingSpawns: true; assistance: false; updateDevice: 'cpu' | 'metal'; observationNoise: true; actionDelay: true }
}
/** Unsupported on-disk version discovered without interpreting its recipe or artifacts. */
export interface RobotIncompatibleRun {
  id: RobotRunId
  formatVersion: number | null
  reason: string
}
/** Durable supported run metadata is authoritative even when the process is absent. */
export interface RobotRun {
  formatVersion: 3
  spec: RobotTrainingSpec
  provenance: RobotRunProvenance
  id: RobotRunId
  state: 'starting' | 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted'
  createdAt: string
  finishedAt: string | null
  observationProfile: ObservationProfile
  recipeHash: string
  sourceFingerprint: string
  progress: { steps: number; total: number; elapsedSeconds: number; reward: number | null } | null
  error: string | null
  policyId: RobotPolicyId | null
  /** Committed atomically with completion; required before an owned policy can load. */
  policySha256: string | null
}
/** Policy metadata distinguishes artifact inspection from behavioral approval. */
export interface RobotPolicy {
  id: RobotPolicyId
  name: string
  runId: RobotRunId | null
  sha256: string
  observationProfile: ObservationProfile
  verification: 'unverified' | 'evaluated'
  /** Whether this intact artifact can execute under the current provider runtime. */
  runtimeCompatibility: RobotCapability
  deployment: RobotCapability
}
/** MuJoCo mesh scene, with local geometry poses in wxyz quaternion order. */
export interface RobotScene {
  bodies: string[]
  meshes: Array<{ v: number[]; f: number[] }>
  geoms: Array<{ mesh: number; body: number; pos: number[]; quat: number[]; mat: string; rgba: number[] }>
  defaultJoints: number[]
  jointNames: string[]
}
/** One kinematic-reference pose or recorded-simulation frame, identified by the containing result's mode; body tuples are xyz then wxyz. */
export interface RobotFrame {
  step: number
  time: number
  bodies: number[][]
  /** Simulation reward; reference poses use zero without evaluating rewards. */
  reward: number
  /** Simulation termination; reference poses use false without running an episode. */
  terminated: boolean
  telemetry: RobotTelemetry
}
/** Bounded recorded simulation, never advertised as live hardware telemetry. */
export interface RobotSimulation {
  mode: 'recorded-simulation'
  policyId: RobotPolicyId
  policyHash: string
  observationProfile: ObservationProfile
  controlHz: 50
  physics: RobotPhysics
  bamSettings: Record<string, number | null>
  frames: RobotFrame[]
}
/** Evaluation criteria are recorded before execution and are not hardware certification. */
export interface RobotEvaluationSpec {
  policyId: RobotPolicyId
  episodes: number
  stepsPerEpisode: number
  seed: number
  maxTerminations: number
  minMeanUprightFraction: number
}
/** Metrics come from deterministic exported-ONNX rollouts without assistance. */
export interface RobotEvaluation {
  id: RobotEvaluationId
  createdAt: string
  physics: RobotPhysics
  policyId: RobotPolicyId
  policyHash: string
  spec: RobotEvaluationSpec
  observationProfile: ObservationProfile
  episodes: Array<{
    seed: number
    steps: number
    terminated: boolean
    reward: number
    uprightFraction: number
    /** Radians: root mean squared qpos error over all fourteen joints and sampled steps; null without a reference. */
    poseRmse: number | null
    bamSettings: Record<string, number | null>
  }>
  passed: boolean
  limitations: string[]
  evaluatedAt: string
}
/** Immutable learning trial identity, independent of its optional training run. */
export type RobotTrialId = string & Branded<'RobotTrialId'>
/** Immutable observation and next-change record identity. */
export type RobotReflectionId = string & Branded<'RobotReflectionId'>
/** Existing deterministic assessment criteria, frozen before training. */
export type RobotEvaluationCriteria = Omit<RobotEvaluationSpec, 'policyId'>
/** A prediction, planned change and evidence plan recorded before training. */
export interface RobotLearningBrief {
  goal: string
  prediction: string
  plannedChange: string
  /** What the learner plans to measure, not a claim of existing results. */
  evidence: string
}
/** Guided trials select a saved project; its clip is resolved by the existing trainer. */
export interface RobotTrialRecipe {
  spec: RobotTrainingRequest & { projectRevisionId: RobotProjectRevisionId; clip: null }
  brief: RobotLearningBrief
  evaluation: RobotEvaluationCriteria
  parentReflectionId: RobotReflectionId | null
}
/** Immutable host-owned trial; saving does not reserve training capacity. */
export interface RobotTrial {
  version: 1
  id: RobotTrialId
  createdAt: string
  projectRevisionId: RobotProjectRevisionId
  projectSha256: string
  recipe: RobotTrialRecipe
  sha256: string
}
/** One immutable run admission per trial, committed before its trainer starts. */
export interface RobotTrialBinding {
  version: 1
  trialId: RobotTrialId
  trialSha256: string
  runId: RobotRunId
  recipeHash: string
  createdAt: string
  sha256: string
}
/** Run state is derived from the existing manifest and process supervisor, never duplicated in a trial. */
export interface RobotTrialEntry { trial: RobotTrial; binding: RobotTrialBinding | null; run: RobotRun | null }
/** Observation of one completed assessment and the learner's next proposed change. */
export interface RobotReflectionRequest {
  trialId: RobotTrialId
  evaluationId: RobotEvaluationId
  observation: string
  interpretation: string
  nextChange: string
}
/** Immutable reflection bound to the trial, completed run, policy bytes and measured report. */
export interface RobotReflection extends RobotReflectionRequest {
  version: 1
  id: RobotReflectionId
  createdAt: string
  trialSha256: string
  runId: RobotRunId
  policyHash: string
  reportSha256: string
  sha256: string
}
/** Public session-owned requests; providers dispatch host persistence and private process operations. */
export type RobotLabRequest =
  | { operation: 'save_trial'; recipe: RobotTrialRecipe }
  | { operation: 'trials' }
  | { operation: 'train_trial' | 'evaluate_trial'; trialId: RobotTrialId }
  | { operation: 'evaluations' }
  | { operation: 'save_reflection'; reflection: RobotReflectionRequest }
  | { operation: 'reflections' }
  | { operation: 'replay_evaluation'; evaluationId: RobotEvaluationId; episodeIndex: number }
  | { operation: 'studio' }
  | { operation: 'save_project'; recipe: RobotProjectRecipe }
  | { operation: 'projects' }
  | { operation: 'project'; projectRevisionId: RobotProjectRevisionId }
  | { operation: 'reference_preview'; projectRevisionId: RobotProjectRevisionId }
  | { operation: 'readiness' }
  | { operation: 'behaviors' }
  | { operation: 'scene' }
  | { operation: 'policies' }
  | { operation: 'runs' }
  | { operation: 'run'; runId: RobotRunId }
  | { operation: 'train'; spec: RobotTrainingRequest }
  | { operation: 'stop'; runId: RobotRunId }
  | { operation: 'simulate'; policyId: RobotPolicyId; steps: number; seed: number; command: number[] }
  | { operation: 'evaluate'; spec: RobotEvaluationSpec }
  | { operation: 'prepare'; policyId: RobotPolicyId }
/** Discriminated JSON replies support the same UI and tool actions. */
export type RobotLabResult =
  | { operation: 'save_trial'; trial: RobotTrial }
  | { operation: 'trials'; trials: RobotTrialEntry[] }
  | { operation: 'train_trial'; trial: RobotTrial; binding: RobotTrialBinding; run: RobotRun }
  | { operation: 'evaluate_trial'; evaluation: RobotEvaluation }
  | { operation: 'evaluations'; evaluations: RobotEvaluation[]; incompleteCount: number }
  | { operation: 'save_reflection'; reflection: RobotReflection }
  | { operation: 'reflections'; reflections: RobotReflection[] }
  | { operation: 'replay_evaluation'; evaluationId: RobotEvaluationId; episodeIndex: number; mode: 'new-resimulation'; simulation: RobotSimulation }
  | { operation: 'studio'; catalog: RobotStudioCatalog }
  | { operation: 'save_project' | 'project'; project: RobotProjectRevision }
  | { operation: 'projects'; projects: RobotProjectRevision[] }
  | { operation: 'reference_preview'; preview: RobotReferencePreview }
  | { operation: 'readiness'; readiness: RobotReadiness }
  | { operation: 'behaviors'; behaviors: RobotBehavior[] }
  | { operation: 'scene'; scene: RobotScene }
  | { operation: 'policies'; policies: RobotPolicy[] }
  | { operation: 'runs'; runs: RobotRun[]; incompatibleRuns: RobotIncompatibleRun[] }
  | { operation: 'run' | 'train' | 'stop'; run: RobotRun }
  | { operation: 'simulate'; simulation: RobotSimulation }
  | { operation: 'evaluate'; evaluation: RobotEvaluation }
  | { operation: 'prepare'; policyId: RobotPolicyId; allowed: false; reasons: string[] }
