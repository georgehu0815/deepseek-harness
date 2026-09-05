# Robot Lab 记录

[English](robot.md) | 中文

本页定义 [`packages/robot/robot-lab/src/types.ts`](../../packages/robot/robot-lab/src/types.ts) 中的项目身份、学习试验、评估证据、训练准入和动作记录。[服务](../../packages/robot/robot-lab/README.md)负责操作，[MicroDuck 提供方](../../packages/robot/robot-lab-microduck/README.md)负责执行与存储，[原生 UI](../../packages/client/ui-robot-lab/README.md)负责编写与回放。[Studio 提案](../../.agents/notes/proposed/feature/2026-09-04-microduck-studio.md)和[学习闭环提案](../../.agents/notes/proposed/feature/2026-09-05-microduck-student-learning-loop.md)记录依据与延期工作。

## 服务请求与结果

服务在提供方分派前解析权威会话；调用方不能选择文件系统根目录。请求和结果共用操作判别字段。缺少提供方时，返回禁用的就绪状态并拒绝其他操作。已注册提供方负责已提交结果与取消语义。

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

## 不可变项目身份

`RobotProfileId`、`RobotTemplateId`、`RobotProjectId` 和 `RobotProjectRevisionId` 是不同的 branded 标识。项目包含分别保存的不可变修订，而不是一份可变配方。模型配置报告实际安装的 MJCF 模型哈希、根部、十四个有序关节、弧度单位、限制和默认位置。模板是带版本的实验性目标，绝不是已训练技能声明。

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

分类和难度指导动作编写，二者都不代表策略能力。`behaviorId` 从行为目录解析已注册的奖励项和训练预算，而非使用 UI 常量。调用方在已注册默认值上合并 `trainingWeights`；修订冻结这些显式模板覆盖值。

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

音乐和动作共用速度与拍数。时长为 `beats * 60 / bpm`。配方持久化，合成的 PCM、WAV 字节和浏览器音频资源不属于项目产物。修改草稿音乐不会改变已保存修订或较早实验。

## 动作组合

可选的非空 `blocks` 列表是配方唯一的有序动作来源。其首个模板与版本必须匹配顶层模板与版本，拍数总和必须同时等于动作和音乐总拍数。每块使用 `blockBeatChoices`；`maxProjectBlocks`、总时长和编译关键帧数量限制同样适用。没有动作块时，配方描述单一模板，使用 `beatChoices`，直接采用总动作幅度。

```ts type-equiv
/** Ordered authored motion block; beats use the project's BPM and moveSize is in [0,1]. */
interface RobotMotionBlock {
  templateId: RobotTemplateId
  templateVersion: 1
  beats: number
  moveSize: number
}
```

保存的有效动作块冻结完整模板元数据，并将编写的块幅度乘以项目总幅度 `parameters.moveSize`。所有块共用项目 BPM。编译器在同一时间轴上连接基于模型的动作块，边界目标回到模型默认姿态。这些是参考目标，不是经过动力学测试的过渡。

```ts type-equiv
/** Frozen effective block; moveSize includes the project's master move-size multiplier. */
interface RobotProjectBlock { template: RobotTemplate; beats: number; moveSize: number }
```

只有所有动作块都推荐 `stand` 时，完整组合的训练才使用它，否则使用 `imitate`。精选覆盖值跨块合并，同一奖励项出现冲突值时被拒绝。UI 将解析后的 `training.weights` 合并到选定行为的已注册默认值上。首块的 `template` 是描述性元数据，不能代替完整动作推荐；显式训练请求保持显式，不被推荐静默改写。

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

项目和编译片段名称保留 Unicode 显示文本。UI 使用 `project-${revision.id}` 作为内部训练名称，并展示实验冻结的 `projectSnapshot.recipe.name`；草稿名称绝不重标旧策略或记录。

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

项目修订格式 2 必须包含解析后的 `blocks` 和 `training`，单模板配方也不例外。模板、音乐与片段格式仍为 1，运行格式仍为 3。旧项目格式被拒绝，不重写或自动迁移。保存后的回放使用冻结的块顺序和记录时间定位当前块；后续草稿不能改变该时间轴。

## 训练准入

绑定项目的请求解析发起会话所属的修订。空片段选择其保存片段；提供片段时必须与保存片段一致。`projectSnapshot` 由提供方持有，调用方输入包含它时被拒绝。实验保留解析后的项目、配乐与来源信息，不查询后续草稿。未绑定项目的自定义片段实验与项目配乐绑定保持独立。

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

CPU SB3 与可选 Apple MLX 是不同学习器，均使用 CPU MuJoCo/BAM 物理仿真。缺少 MLX 时失败，不回退。运行格式 3 保留准确配方与导出哈希；不支持的记录单独列出，不迁移。运行时兼容性和历史评估是不同事实。本地原型的硬件准备始终返回 `allowed: false`。

## 帧数值与单位

每一帧必须包含遥测。在仿真记录中，关节数组遵循片段与模型配置的顺序，而非任意 MJCF 存储索引：`jointPosition` 读取实际 qpos，`jointVelocity` 读取实际 qvel。控制器目标是环境延迟后的 MuJoCo ctrl，不是实测关节角，也不是 BAM 总线接收时间戳。施加扭矩包含铰链自由度上的 BAM 与 XML 广义执行器贡献。根部速度是已识别根部的世界坐标 xyz 速度，速率为其模长，而不只是水平速度。根部倾角是身体正 z 轴与世界向上方向的夹角。

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

记录模式决定帧值的含义。运动学参考使用编写的 qpos 与正向姿态，不执行物理积分。其关节速度、根部世界速度、根部速率、控制器目标与执行器扭矩均为空：不可用的测量不得显示成实测零值。根部倾角来自目标姿态，不是动态平衡证据。仿真记录提供实测速度和执行器数据。两种模式都不记录足部接触。客户端将角度转换为度仅影响展示。

## 参考与策略记录的区别

参考预览绑定准确项目修订与哈希。正向运动学检查模型姿态，不检查平衡、安全碰撞执行或策略学习。Consumer 将其标为 **Target preview / Not physics-tested**。MicroDuck 提供方要求帧上限至少为二，以同时包含零时刻和完整时长端点；更小的上限被拒绝，中间姿态可能降采样。Consumer 使用帧时间戳，不假定相邻帧恰好间隔一个控制周期。

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

策略记录绑定导出策略字节、观测语义和物理设置。请求的控制步时限可能提前终止。回放由记录时间戳决定，而非参考时长；延长或重复短记录不能证明持续控制。实验完成、直立比例或目标跟踪指标都不是编舞认证。

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

## 学习试验与反思

学习简述包含四个字符串：目标、预测、计划改变和计划证据。`evidence` 表示要测量的内容，不是已存在结果的声明。`save_trial` 提交必须关联项目的完整配方后，`train_trial` 才能准入其唯一运行。试验、绑定和反思是宿主拥有的不可变版本 1 记录；项目保持版本 2，运行保持版本 3。保存试验不会预留容量。进程状态来自现有运行，而非重复的生命周期。

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

`save_reflection` 将学习者的观察、解释和拟议的下一项改变绑定到匹配试验冻结标准、实际运行及策略字节的完成报告。缺失、跨会话、不匹配或被篡改的证据会被拒绝。子试验记录已提交反思的 id。创建改进草稿不等于保存；只有新的 `save_trial` 才提交谱系。两种操作都不修改既有证据或从检查点续训。

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

## 评估证据与重新仿真

`evaluate_trial` 解析绑定的已完成运行，并应用试验冻结的标准。探索性 `evaluate` 接受显式标准，但标准不同时不能将其呈现为预注册评估。`evaluations` 返回经过验证的完成报告，并通过单独的 `incompleteCount` 统计没有报告的准入记录。无效记录以及已配置的列表或响应限制会明确报错；它们不是空历史或成功结果。

```ts type-equiv
/** Evaluation criteria are recorded before execution and are not hardware certification. */
interface RobotEvaluationSpec {
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
```

报告比较描述证据，不自动评选优胜者。评估设置、观测语义、冻结物理和已加载的执行运行时来源信息必须匹配，才能进行同条件评估。目标、参考动作、预算、学习器和种子仍是可见差异；多项改变不构成受控的单变量实验。直立比例、终止次数和可用的跟踪误差不评估完整编舞、稳健性或实机安全。

`replay_evaluation` 仅支持会话拥有的运行策略，返回 `new-resimulation`，而非原始评估帧。提供方验证报告、策略字节及当前运行时兼容性，再使用选定回合保存的种子、报告请求的时限及受支持的零命令。提前终止不会将请求时限替换为记录的回合长度。浏览器不能代入当前草稿输入，历史通过结果绝不覆盖不兼容状态。评估与探索性 Perform 时长相互独立；没有操作授权硬件。

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
