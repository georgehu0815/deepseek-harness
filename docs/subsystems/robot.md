# Robot Lab records

English | [中文](robot.zh.md)

This page defines project identity, learning trials, evaluation evidence, training admission and recorded motion from [`packages/robot/robot-lab/src/types.ts`](../../packages/robot/robot-lab/src/types.ts). The [service](../../packages/robot/robot-lab/README.md) owns operations, the [MicroDuck provider](../../packages/robot/robot-lab-microduck/README.md) owns execution and storage, and the [native UI](../../packages/client/ui-robot-lab/README.md) owns authoring and playback. The [Studio proposal](../../.agents/notes/proposed/feature/2026-09-04-microduck-studio.md) and [learning-loop proposal](../../.agents/notes/proposed/feature/2026-09-05-microduck-student-learning-loop.md) record rationale and deferred work.

## Service requests and results

The service resolves an authoritative session before provider dispatch; callers cannot select filesystem roots. Requests and results share an operation discriminator. Provider absence returns disabled readiness and rejects other operations. Registered providers own committed results and cancellation semantics.

```ts type-equiv
/** Provider implementation receives an authoritative session, never a caller-supplied directory. */
interface RobotLabProvider {
  /**
   * Execute an owned operation.
   * @param session - Owning session.
   * @param request - Validated wire request.
   * @param signal - Request cancellation.
   * @returns The committed result.
   */
  execute(session: Session, request: RobotLabRequest, signal: AbortSignal): Promise<RobotLabResult>
}
```

```ts type-equiv
/** Public session-owned requests; providers dispatch host persistence and private process operations. */
type RobotLabRequest =
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
```

```ts type-equiv
/** Discriminated JSON replies support the same UI and tool actions. */
type RobotLabResult =
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
```

## Immutable project identity

`RobotProfileId`, `RobotTemplateId`, `RobotProjectId` and `RobotProjectRevisionId` are distinct branded identifiers. A project has independently saved immutable revisions, not one mutable recipe. Profiles report the actual installed MJCF model hash, root body, fourteen ordered joints, radians, limits and default positions. Templates are versioned experimental targets, never trained-skill declarations.

```ts type-equiv
/** Installed robot adapter identity; the catalog lists only available model adapters. */
type RobotProfileId = string & Branded<'RobotProfileId'>
```

```ts type-equiv
/** Versioned authored motion identity, not a trained skill. */
type RobotTemplateId = string & Branded<'RobotTemplateId'>
```

```ts type-equiv
/** Immutable saved project revision identity. */
type RobotProjectRevisionId = string & Branded<'RobotProjectRevisionId'>
```

```ts type-equiv
/** Stable project identity shared by independently saved immutable revisions. */
type RobotProjectId = string & Branded<'RobotProjectId'>
```

```ts type-equiv
/** Actual MJCF model metadata in the clip's fourteen-joint order. */
interface RobotProfile {
  id: RobotProfileId
  label: string
  modelSha256: string
  rootBody: { name: string; index: number }
  joints: Array<{ name: string; index: number; lower: number; upper: number; defaultPosition: number; unit: 'rad' }>
  hardwareAvailable: false
}
```

```ts type-equiv
/** Explicit authored motion parameters; moveSize is bounded to [0,1]. */
interface RobotStudioParameters { bpm: number; beats: number; moveSize: number }
```

```ts type-equiv
/** Curated experimental motion; availability never asserts learned execution quality. */
interface RobotTemplate {
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
```

Category and difficulty guide authoring; neither asserts policy competence. `behaviorId` resolves registered reward terms and training budgets from the behavior catalog, not from UI constants. Callers merge `trainingWeights` over those registered defaults; the revision freezes these explicit template overrides.

```ts type-equiv
/** Available model and template data, independent of optional MLX readiness. */
interface RobotStudioCatalog {
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
```

```ts type-equiv
/** Browser-synthesized audio recipe; no audio provider or audio bytes are persisted. */
interface RobotMusicRecipe {
  version: 1
  style: 'disco' | 'electronic' | 'lofi' | 'chiptune'
  bpm: number
  beats: number
  seed: number
}
```

Music and motion share tempo and beat count. Duration is `beats * 60 / bpm`. The recipe is durable; synthesized PCM, WAV bytes and browser audio resources are not project artifacts. Changing a draft's music does not change a saved revision or an earlier run.

## Motion composition

An optional nonempty `blocks` list is the recipe's sole ordered motion source. Its first template/version must match the top-level template/version, and its beats must sum to both motion and music totals. Each block uses `blockBeatChoices`; `maxProjectBlocks`, total duration and compiled-key limits also apply. Without blocks, the recipe describes one template using `beatChoices` and the master move size directly.

```ts type-equiv
/** Ordered authored motion block; beats use the project's BPM and moveSize is in [0,1]. */
interface RobotMotionBlock {
  templateId: RobotTemplateId
  templateVersion: 1
  beats: number
  moveSize: number
}
```

A saved effective block freezes its full template metadata and multiplies the authored block size by the project's master `parameters.moveSize`. All blocks share the project's BPM. The compiler joins model-derived blocks on one timeline; boundary targets return to the model default pose. These are reference targets, not dynamically tested transitions.

```ts type-equiv
/** Frozen effective block; moveSize includes the project's master move-size multiplier. */
interface RobotProjectBlock { template: RobotTemplate; beats: number; moveSize: number }
```

Whole-composition training uses `stand` only when every block recommends it; otherwise it uses `imitate`. Curated overrides combine across blocks, and conflicting values for one reward key are rejected. The UI merges the resolved `training.weights` over the chosen behavior's registered defaults. The first block's `template` is descriptive metadata, not a substitute for this complete-motion recommendation; explicit training requests remain explicit rather than silently rewritten by the recommendation.

```ts type-equiv
/** Backend-resolved reward recommendation for the whole compiled motion. */
interface RobotProjectTraining { behaviorId: string; weights: Record<string, number> }
```

```ts type-equiv
/** Save creates a new immutable revision; projectId null creates a new project. */
interface RobotProjectRecipe {
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
```

Project and compiled clip names preserve Unicode display text. The UI uses `project-${revision.id}` as its internal training name and displays the run's frozen `projectSnapshot.recipe.name`; draft names never relabel old policies or recordings.

```ts type-equiv
/** Complete frozen project data, content-hashed before publication. */
interface RobotProjectRevision {
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
```

Project revision format 2 requires both resolved `blocks` and `training`, including for a single-template recipe. Template, music and clip formats remain 1; run format remains 3. Older project formats are rejected, not rewritten or automatically migrated. Saved playback uses frozen block order and recording time to locate the current block; later drafts cannot change that timeline.

## Training admission

A project-bound request resolves a revision owned by the initiating session. A null clip selects its saved clip; a supplied clip must match it. `projectSnapshot` is provider-owned and rejected in caller input. The run retains the resolved project, soundtrack and provenance without consulting later drafts. Unlinked custom-clip experiments remain separate from project soundtrack binding.

```ts type-equiv
/** Admission request; omitting backend explicitly resolves to CPU. */
interface RobotTrainingRequest {
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
```

```ts type-equiv
/** Frozen training request with an explicit learner selection. */
interface RobotTrainingSpec extends RobotTrainingRequest {
  backend: RobotTrainingBackend
  /** Present only for project-bound admission; no mutable project lookup during training. */
  projectSnapshot?: RobotProjectRevision
}
```

`RobotTrainingBackend` is `'cpu' | 'mlx' | 'rlx'`: CPU SB3, DSH-owned MLX PPO and configured RLX PPO are distinct learners with CPU MuJoCo/BAM physics. An unavailable selection fails without fallback. Run format 3 retains exact recipes and exported hashes; completed RLX records also require `RobotRun.artifactSha256` to bind their complete inference-artifact manifest. That property is optional for other backends and unfinished runs. Unsupported records are listed separately without migration. Runtime compatibility and historical evaluation are different facts. Hardware preparation always returns `allowed: false` for local prototypes.

<a id="run-progress"></a>

### Run progress and optional RLX observations

`RobotRun.progress` is a nullable, point-in-time training observation, not policy approval. Its `elapsedSeconds` excludes checkpoint and export work. Optional `progress.rlx` records completed RLX intervals and may lag completion; absent statistics remain unknown, not zero, and runs without them remain readable.

```ts type-equiv
/** Optional RLX observations; cumulative completed intervals exclude ongoing work and do not establish skill. */
interface RobotRlxProgress {
  version: 1
  /** Fully completed rollout/update pairs, not individual optimizer steps. */
  completedRollouts: number
  /** Optimizer steps in fully completed updates; excludes partial work in an unfinished or failed update. */
  optimizerSteps: number
  /** Mean of the last rollout's already-computed weighted total minibatch objectives; null before an update. */
  lastMeanLoss: number | null
  /** Collector wall time includes environment calls and inference; it is not isolated CPU physics time. */
  collectionSeconds: number
  /** Update wall time includes GAE and deferred critic work, not isolated GPU compute time. */
  updateSeconds: number
  /** Separate from the training elapsed clock; null until checkpoint serialization completes. */
  checkpointSeconds: number | null
  /** Includes ONNX export and parity verification; null until that operation completes. */
  exportSeconds: number | null
}
```

Collection/update times accumulate completed intervals; counters and timings exclude partial work in unfinished or failed phases. `completedRollouts` counts finished collection/update pairs; `optimizerSteps` counts actual minibatch optimizer steps only within fully completed updates. An update may apply a minibatch then fail while the reported count remains zero; zero counters or accumulated times do not prove no work occurred. `lastMeanLoss` averages the last fully completed update's weighted total minibatch objectives, not separately measured policy, value or entropy losses; it is null until an update fully completes. Collection includes environment calls and inference. Update includes GAE, deferred critic work and optimizer work. These are wall-clock intervals, not isolated CPU/GPU costs; transfer time is unmeasured. Checkpoint and export timings remain null until their operations succeed; export includes ONNX generation and parity verification. A measured checkpoint write does not make a checkpoint resumable. Memory, warmup and cold-versus-warm cost attribution remain unmeasured by these fields.

These phases do not partition end-to-end cost: initial environment reset and its MLX evaluation count toward training elapsed time but precede collection, model/worker construction precedes that clock, and observer notification runs outside phase intervals.

```ts type-equiv
/** Durable supported run metadata is authoritative even when the process is absent. */
interface RobotRun {
  /** Optional immutable choreography assessment resolved before this run's trainer starts. */
  dancePlan?: RobotDancePlan
  /** Completed RLX runs bind their checkpoint, normalizer, parity report and policy through this manifest digest. */
  artifactSha256?: Record<string, string>
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
  /** Sampled training clock excludes checkpoint/export; optional RLX metrics may lag and never approve a policy. */
  progress: { steps: number; total: number; elapsedSeconds: number; reward: number | null; rlx?: RobotRlxProgress } | null
  error: string | null
  policyId: RobotPolicyId | null
  /** Committed atomically with completion; required before an owned policy can load. */
  policySha256: string | null
}
```

<a id="policy-observations"></a>

## Policy observations and seeded nominal physics

The current Lab environment returns a fresh float32 observation from each `reset` and `step`; retained arrays are not reused for later samples. The `microduck-standard-61` layout uses these zero-based, half-open slices:

| Slice | Meaning |
|---|---|
| `[0:3]` | Gyroscope |
| `[3:6]` | Projected gravity |
| `[6:20]` | Joint positions relative to the default pose |
| `[20:34]` | Joint velocities with one control step of observation lag |
| `[34:48]` | Last raw policy action, not clipped actuation |
| `[48:51]` | Twist command: forward/lateral velocity and yaw rate |
| `[51:55]` | Head-pose commands |
| `[55:61]` | Body-pose commands |

The shipped-policy rollout consumes the returned observation once per control step, copies it, and overlays only `[48:51]` with the requested twist; it also sets the environment's twist command. Sensor, last-action and head/body channels remain unchanged, as does the retained source array. Calling `_get_obs` again would advance velocity history and erase the intended lag. Owned-run inference consumes the returned observation without that overlay. Lab imitation replaces body-command indices 59–60 with sin/cos phase (`microduck-lab-body-phase-61`), so equal 61-element widths do not establish compatibility with a standard body-pose controller. Observation cadence and array preservation do not authenticate a controller's upstream provenance or qualify its behavior.

<a id="nominal-physics"></a>

Nominal seeded BAM evaluation disables observation noise, domain randomization and random yaw, not every stochastic component. Reset still adds seeded joint perturbations of ±0.03 rad and root-height lift in `[0, 0.01)` m, zeroes velocities and initializes controls at that perturbed pose. `standing_spawns=True` bypasses special spawn families; it does not settle the robot or solve a standing equilibrium. BAM retains startup battery-voltage and sag-gain sampling and draws a 3–6-physics-step lag per substep (15–30 ms at the current 0.005-second physics interval, clamped to available history at startup). Its lag replaces, rather than stacks with, the XML path's separate 0/1-control-step delay.

Each rollout constructs a fresh environment and resets it with the same episode seed; evaluation uses `seed + episodeIndex`. BAM reseeding does not redraw construction-time battery values, so resetting an environment built with another seed is not equivalent. These flags do not fully describe the reset distribution, command sampling or actuator variability; source/runtime identity and recorded BAM settings remain necessary. Seeded evaluation is neither an unperturbed start nor evidence that all seeds produce identical trajectories. Commanding a position reference without body-balance feedback does not itself establish balance; its failure alone does not establish target infeasibility or justify changing assessment thresholds.

## Native pose scene metadata

`RobotScene` supplies body names, colored mesh geometry and the fourteen-joint ordering. Its optional `kinematics` member carries `RobotSceneKinematics` for local authoring; recorded playback does not require it. The MicroDuck provider derives this metadata from the installed MJCF model. A live pose stage requires it and does not substitute a guessed skeleton or recorded policy frames.

| Field | Meaning |
|---|---|
| `rootBody`, `rootPosition` | Free-root body index and its STAND world position in meters. Authored root pitch replaces its orientation with a right-handed rotation about +Y; negative pitch leans backward. |
| `bodies` | Parent-first rest transforms in `scene.bodies` order: parent index, local xyz position and unit wxyz quaternion. Body zero is the identity world body. |
| `joints` | Fourteen distinct non-root hinges in `scene.jointNames` order: driven body index, body-local anchor, unit axis and `qpos0` reference. Authored joint values are absolute radians, not offsets from STAND. |

The Python reply parser validates vector widths, finite values, rotation normalization, parent ordering and distinct driven bodies before publishing metadata. Browser forward kinematics changes only rendered transforms; visual grounding places the lowest rendered vertex on the floor without changing the authored joints, root pitch or physical state. These poses carry no measured balance, actuator or hardware-safety evidence.

## Frame values and units

Every frame requires telemetry. In recorded simulation, joint arrays follow the clip/profile order, not arbitrary MJCF storage indices: `jointPosition` reads actual qpos and `jointVelocity` actual qvel. Controller targets are MuJoCo ctrl after environment delay, not measured joint angles or BAM bus receipt timestamps. Applied torque includes BAM and XML generalized actuator contributions at hinge DOFs. Root velocity is world-frame xyz for the identified root body; speed is its magnitude, not horizontal speed alone. Root tilt is the angle between the body's positive z axis and world up.

```ts type-equiv
/** Kinematic pose or recorded simulation measurements; unavailable reference channels are null. */
interface RobotTelemetry {
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
```

```ts type-equiv
/** One kinematic-reference pose or recorded-simulation frame, identified by the containing result's mode; body tuples are xyz then wxyz. */
interface RobotFrame {
  step: number
  time: number
  bodies: number[][]
  /** Simulation reward; reference poses use zero without evaluating rewards. */
  reward: number
  /** Simulation termination; reference poses use false without running an episode. */
  terminated: boolean
  telemetry: RobotTelemetry
}
```

The recording mode determines the meaning of frame values. A kinematic reference uses authored qpos and forward poses, not integrated physics. Its joint velocity, root world velocity, root speed, controller target and actuator torque are null: unavailable measurements must not appear as measured zero. Its root tilt is computed from the target pose, not evidence of dynamic balance. Recorded simulations supply measured velocity and actuator channels. Foot contacts are not recorded in either mode. Client angle conversion to degrees is presentation only.

## Reference versus policy recording

A reference preview binds its exact project revision and hash. Forward kinematics checks the model's pose, not balance, collision-safe execution or policy learning. Consumers label it **Target preview / Not physics-tested**. The MicroDuck provider requires a frame cap of at least two to include both zero and duration endpoints; it rejects smaller caps and may downsample intermediate poses. Consumers use frame timestamps rather than assuming every frame is one control tick apart.

```ts type-equiv
/** Kinematic MuJoCo forward poses, not learned-policy or dynamically feasible motion. */
interface RobotReferencePreview {
  mode: 'kinematic-reference'
  projectRevisionId: RobotProjectRevisionId
  projectSha256: string
  controlHz: 50
  frames: RobotFrame[]
  limitations: string[]
}
```

A policy recording binds exported policy bytes, observation semantics and physics settings. Its requested control-step horizon can terminate early. Recorded timestamps, not reference duration, govern playback; extending or repeating a short recording does not demonstrate sustained control. A completed run, upright fraction or target-tracking metric is not choreography certification.

```ts type-equiv
/** Bounded recorded simulation, never advertised as live hardware telemetry. */
interface RobotSimulation {
  mode: 'recorded-simulation'
  policyId: RobotPolicyId
  policyHash: string
  observationProfile: ObservationProfile
  controlHz: 50
  physics: RobotPhysics
  bamSettings: Record<string, number | null>
  frames: RobotFrame[]
}
```

## Learning trials and reflection

A learning brief contains four strings: goal, prediction, planned change and planned evidence. Its `evidence` is what to measure, not a claim that a result exists. `save_trial` commits the complete project-required recipe before `train_trial` may admit its one run. The trial, binding and reflection are immutable host-owned version-1 records; projects remain version 2 and runs version 3. Saving a trial does not reserve capacity. Its process state comes from the existing run, not a duplicate lifecycle.

```ts type-equiv
/** Immutable learning trial identity, independent of its optional training run. */
type RobotTrialId = string & Branded<'RobotTrialId'>
```

```ts type-equiv
/** Immutable observation and next-change record identity. */
type RobotReflectionId = string & Branded<'RobotReflectionId'>
```

```ts type-equiv
/** Existing deterministic assessment criteria, frozen before training. */
type RobotEvaluationCriteria = Omit<RobotEvaluationSpec, 'policyId'>
```

```ts type-equiv
/** A prediction, planned change and evidence plan recorded before training. */
interface RobotLearningBrief {
  goal: string
  prediction: string
  plannedChange: string
  /** What the learner plans to measure, not a claim of existing results. */
  evidence: string
}
```

```ts type-equiv
/** Guided trials select a saved project; its clip is resolved by the existing trainer. */
interface RobotTrialRecipe {
  spec: RobotTrainingRequest & { projectRevisionId: RobotProjectRevisionId; clip: null }
  brief: RobotLearningBrief
  evaluation: RobotEvaluationCriteria
  parentReflectionId: RobotReflectionId | null
}
```

```ts type-equiv
/** Immutable host-owned trial; saving does not reserve training capacity. */
interface RobotTrial {
  version: 1
  id: RobotTrialId
  createdAt: string
  projectRevisionId: RobotProjectRevisionId
  projectSha256: string
  recipe: RobotTrialRecipe
  sha256: string
}
```

```ts type-equiv
/** One immutable run admission per trial, committed before its trainer starts. */
interface RobotTrialBinding {
  /** Host canonical hash of the entire resolved plan, including its opaque Python digest; committed before training. */
  dancePlanSha256?: string
  version: 1
  trialId: RobotTrialId
  trialSha256: string
  runId: RobotRunId
  recipeHash: string
  createdAt: string
  sha256: string
}
```

```ts type-equiv
/** Run state is derived from the existing manifest and process supervisor, never duplicated in a trial. */
interface RobotTrialEntry { trial: RobotTrial; binding: RobotTrialBinding | null; run: RobotRun | null }
```

`save_reflection` binds the learner's observation, interpretation and proposed next change to a completed report matching the trial's frozen criteria, actual run and policy bytes. Missing, foreign-session, mismatched or tampered evidence is rejected. A child trial records the committed reflection's id. Creating an improvement draft does not save it; only a new `save_trial` commits lineage. Neither operation edits prior evidence or resumes a checkpoint.

```ts type-equiv
/** Observation of one completed assessment and the learner's next proposed change. */
interface RobotReflectionRequest {
  trialId: RobotTrialId
  evaluationId: RobotEvaluationId
  observation: string
  interpretation: string
  nextChange: string
}
```

```ts type-equiv
/** Immutable reflection bound to the trial, completed run, policy bytes and measured report. */
interface RobotReflection extends RobotReflectionRequest {
  version: 1
  id: RobotReflectionId
  createdAt: string
  trialSha256: string
  runId: RobotRunId
  policyHash: string
  reportSha256: string
  sha256: string
}
```

<a id="dance-assessment"></a>

## Frozen choreography assessment

Optional trial `evaluation.dance` contains explicit thresholds, not calibrated defaults. Criteria and plan versions must both be 1 or both be 2; unknown or mismatched versions fail. Version-1 rules remain valid for history and explicit admission, including frozen trials that have not started. Version 2 requires prospective criteria; no automatic upgrade rewrites a saved plan, verdict, reason or hash. `requiredCycles` is a positive integer; joint RMSE has fourteen nonnegative radian thresholds, one to fourteen moving-joint indices are unique integers in `[0,13]`, and the episode pass fraction is in `(0,1]`. Excursion, gain and amplitude minima are positive; the amplitude maximum cannot be below its minimum. Root-orientation RMSE and horizontal-drift limits are nonnegative. The provider rejects a horizon too short for the required runtime cycles.

```ts type-equiv
/** Explicit experimental choreography thresholds; every required cycle is checked without time alignment. */
interface RobotDanceCriteria {
  /** V1 rejects observed fragments; v2 requires whole-window RMSE bounds and full-coverage movement checks. */
  version: 1 | 2
  requiredCycles: number
  minPassedEpisodeFraction: number
  maxJointRmseRad: number[]
  maxRootOrientationRmseRad: number
  movingJointIndices: number[]
  minReferenceExcursionRad: number
  minAmplitudeRatio: number
  maxAmplitudeRatio: number
  minReferenceGainRatio: number
  maxHorizontalDriftMeters: number
}
```

```ts type-equiv
/** Authored and actual simulator reference clocks, frozen before training. */
interface RobotDanceReference {
  clipSha256: string
  sampledSha256: string
  jointNames: string[]
  rootBody: string
  rootConvention: 'initial-heading-world-up-pitch-v1'
  authoredDurationSeconds: number
  controlDtSeconds: number
  cycleSteps: number
  cycleSeconds: number
  loop: boolean
  blocks: Array<{ index: number; startStep: number; endStep: number; activeJointIndices: number[] }>
}
```

```ts type-equiv
/** Policy-independent scientific inputs resolved during trial admission, before the trainer starts. */
interface RobotDancePlan {
  /** Matches the frozen criteria version; historical plans are not automatically upgraded. */
  version: 1 | 2
  evaluation: RobotEvaluationCriteria & { dance: RobotDanceCriteria }
  reference: RobotDanceReference
  evaluatorSha256: string
  sourceFingerprint: string
  physics: RobotPhysics
  runtimeVersions: Record<string, string>
  environment: { behaviorId: string; weights: Record<string, number> }
  /** Hash of all preceding plan fields; policy identity and training seed are deliberately excluded. */
  sha256: string
}
```

The plan freezes the raw clip and sampled-reference hashes, actual control interval, cycle/block grid, named joints/root, physics and runtime/evaluator identity before training. The host binding's `dancePlanSha256` hashes the entire decoded plan, including its Python-owned `sha256`; these two hashes use their respective owners' canonicalization and are not interchangeable. A direct dance evaluation requires the owned run's matching pre-training plan and identical criteria. Missing plans cannot be reconstructed retrospectively from a current target or threshold preset.

```ts type-equiv
/** A choreography verdict is independent of the legacy balance verdict. */
type RobotDanceStatus = 'passed' | 'failed' | 'incomplete'
```

```ts type-equiv
/** Measured control-rate interval; missing measurements are null, never filled with reference values. */
interface RobotDanceWindow {
  index: number
  steps: number
  /** Samples with finite joint, root-orientation and root-position measurements. */
  measuredSteps: number
  complete: boolean
  /** Observed common-mask RMSE, not the v2 whole-window lower bound. */
  jointRmseRad: number[] | null
  /** Observed common-mask orientation RMSE, not the v2 whole-window lower bound. */
  rootOrientationRmseRad: number | null
  /** Fourteen entries; target-inactive joints have null movement ratios. */
  amplitudeRatio: Array<number | null>
  referenceGainRatio: Array<number | null>
  maxHorizontalDriftMeters: number | null
  status: RobotDanceStatus
  reasons: string[]
}
```

```ts type-equiv
/** Full-rate measurements for one episode, including all requested cycles and authored blocks. */
interface RobotDanceEpisode {
  completedCycles: number
  terminated: boolean
  truncated: boolean
  cycles: Array<RobotDanceWindow & { blocks: RobotDanceWindow[] }>
  status: RobotDanceStatus
  reasons: string[]
}
```

Both versions record joint/root RMSE and centered movement ratios on the observed finite subset; version 2 does not replace these fields with whole-window scores. Version 1 rejects observed-fragment threshold violations even when coverage is incomplete. Such a rejection does not prove that every completion of the planned window would violate the same mean or ratio threshold.

For version 2, let `m = measuredSteps` and `N` be that window's planned sample count: `reference.cycleSteps` for a cycle, or the frozen block's `endStep - startStep` for a block. With observed RMSE, the whole-window lower bound is `observedRmse * sqrt(m / N)`. A joint/root RMSE check fails only when this bound strictly exceeds its frozen limit. This follows from nonnegative unobserved squared errors; it does not fill missing samples with zero error or fabricate a measured whole-window score. Missing metrics remain null.

Version-2 amplitude/gain checks cannot decide failure until `m = N`; full finite coverage permits those checks even if termination makes the window incomplete. Maximum horizontal drift is monotonic under additional measurements and can fail on partial coverage. No incomplete window can pass. Episode termination or early truncation independently causes failure; a low RMSE bound does not override it. Each cycle and block is checked independently under its own planned length.

Metrics use full-rate finite measurements, not decimated viewer frames or filled gaps. Movement ratios are dimensionless and target-inactive joints remain null. Every required cycle and block retains its verdict and reasons. `completedCycles` counts elapsed reference-clock cycles from executed control steps, not passed choreography cycles or full finite measurement coverage. The aggregate dance verdict compares passed episodes with `minPassedEpisodeFraction`; incomplete episodes remain unresolved when they could change that result. Balance `passed` stays independent. [The assessment decision](../../.agents/notes/implemented/feature/2026-09-05-microduck-frozen-choreography-assessment.md) distinguishes this experimental measurement from general skill and hardware qualification.

## Evaluation evidence and re-simulation

`evaluate_trial` resolves the completed bound run and applies its trial's frozen criteria. Exploratory `evaluate` accepts explicit criteria but must not be presented as the pre-registered assessment when they differ. `evaluations` returns validated completed reports and a separate `incompleteCount` for admissions without reports. Invalid records and configured list or response limits fail clearly; they are not empty histories or successful results.

```ts type-equiv
/** Evaluation criteria are recorded before execution and are not hardware certification. */
interface RobotEvaluationSpec {
  /** Requires a matching pre-training plan on the owned run; no retrospective defaults are introduced. */
  dance?: RobotDanceCriteria
  policyId: RobotPolicyId
  episodes: number
  stepsPerEpisode: number
  seed: number
  maxTerminations: number
  minMeanUprightFraction: number
}
```

```ts type-equiv
/** Metrics come from deterministic exported-ONNX rollouts without assistance. */
interface RobotEvaluation {
  /** Present together only when the frozen request contains dance criteria. */
  dancePlan?: RobotDancePlan
  danceStatus?: RobotDanceStatus
  id: RobotEvaluationId
  createdAt: string
  physics: RobotPhysics
  policyId: RobotPolicyId
  policyHash: string
  spec: RobotEvaluationSpec
  observationProfile: ObservationProfile
  episodes: Array<{
    dance?: RobotDanceEpisode
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
```

Report comparison is descriptive, not an automatic winner score. Assessment settings, observation semantics, frozen physics and the loaded execution-runtime provenance must match for a like-for-like assessment. If either report contains choreography evidence, both must carry the same plan identity; a missing or different plan blocks like-for-like comparison. Objectives, targets, budgets, learners and seeds remain visible differences; several changes do not constitute a controlled single-variable experiment. Upright fraction, terminations and available tracking error do not assess full choreography, robustness or physical safety.

`replay_evaluation` supports only session-owned run policies and returns `new-resimulation`, not original evaluation frames. The provider verifies the report, policy bytes and current runtime compatibility, then uses the selected episode's saved seed, the report's requested horizon and supported zero command. Early termination does not replace the requested horizon with the recorded episode length. The browser cannot substitute current draft inputs, and a historical pass never overrides incompatibility. Evaluation and exploratory Perform durations are independent; no operation authorizes hardware.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxrobotlab--robotlabruntime"></a>

### `ctx.robotLab` — `RobotLabRuntime`

Service Definition shared by browser remotes and model-facing tools.

```ts cordis-catalog
/**
 * Install one provider.
 * @param provider - Implementation.
 * @returns Effect disposer.
 */
registerProvider(provider: RobotLabProvider): () => void

/**
 * Execute through the same authority for UI and tools.
 * @param agent - Exact owning agent.
 * @param request - JSON request.
 * @param signal - Cancellation.
 * @returns Provider result.
 */
async execute(agent: Agent, request: RobotLabRequest, signal: AbortSignal): Promise<RobotLabResult>

/**
 * Submit a browser operation with the gateway-resolved session owner.
 * @param agent - Authoritative agent resolved by the API identity policy.
 * @param request - Requested operation and its validated input fields.
 * @returns Committed result; admitted training continues independently of the browser.
 */
@Remote('request') request(agent: Agent, request: RobotLabRequest): Promise<RobotLabResult>
```

Types: [Agent](core.md)

Source: [`packages/robot/robot-lab/src/index.ts:52`](../../packages/robot/robot-lab/src/index.ts)
<!-- END GENERATED cordis-surface -->
