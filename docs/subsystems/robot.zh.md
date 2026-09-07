# Robot Lab 记录

[English](robot.md) | 中文

本页定义 [`packages/robot/robot-lab/src/types.ts`](../../packages/robot/robot-lab/src/types.ts) 中的项目身份、学习试验、评估证据、训练准入和动作记录。[服务](../../packages/robot/robot-lab/README.zh.md)负责操作，[MicroDuck 提供方](../../packages/robot/robot-lab-microduck/README.zh.md)负责执行与存储，[原生 UI](../../packages/client/ui-robot-lab/README.zh.md)负责编写与回放。[Studio 提案](../../.agents/notes/proposed/feature/2026-09-04-microduck-studio.zh.md)和[学习闭环提案](../../.agents/notes/proposed/feature/2026-09-05-microduck-student-learning-loop.zh.md)记录依据与延期工作。

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

`RobotTrainingBackend` 为 `'cpu' | 'mlx' | 'rlx'`：CPU SB3、DSH 自有 MLX PPO 和已配置的 RLX PPO 是不同学习器，均使用 CPU MuJoCo/BAM 物理仿真。所选后端不可用时失败，不回退。运行格式 3 保留准确配方与导出哈希；已完成的 RLX 记录还要求 `RobotRun.artifactSha256`，用于绑定完整推理产物 manifest（元数据清单）。对于其他后端和未完成运行，该属性可选。不支持的记录单独列出，不迁移。运行时兼容性和历史评估是不同事实。本地原型的硬件准备始终返回 `allowed: false`。

<a id="run-progress"></a>

### 运行进度与可选 RLX 观测

`RobotRun.progress` 是可为 null 的某一时点训练观测，不是策略批准依据。其 `elapsedSeconds` 不含检查点与导出工作。可选的 `progress.rlx` 记录已完成 RLX 区间，可能落后于完成状态；缺少统计仍表示未知而不是零，不含这些统计的运行仍可读取。

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

采集／更新时间累加已完成区间；计数与计时不含未完成或失败阶段中的部分工作。`completedRollouts` 统计已完成的采集／更新对；`optimizerSteps` 仅统计完整完成更新内的实际小批次优化器步数。一次更新可能执行一个小批次后失败，而报告计数仍为零；计数或累积时间为零不证明没有执行工作。`lastMeanLoss` 对最后一次完整完成更新的加权总小批次目标求均值，不是分别测量的策略、价值或熵损失；在一次更新完整完成前为 null。采集包括环境调用与推理；更新包括 GAE、延迟执行的价值网络计算与优化器工作。这些是墙钟区间，不是独立 CPU／GPU 成本；传输时间未测量。检查点与导出计时在相应操作成功前保持 null；导出包含 ONNX 生成和一致性验证。测得检查点写入耗时不代表检查点可续训。这些字段仍不测量内存、预热以及冷启动与热运行成本归因。

这些阶段不构成完整的端到端成本分解：初始环境重置及其 MLX 求值计入训练已用时间，但发生在采集前；模型／工作进程构建发生在该时钟启动前，观测器通知也在阶段区间之外执行。

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

## 策略观测与固定种子的标称物理

当前 Lab 环境在每次 `reset` 和 `step` 时返回新分配的 float32 观测；保留的数组不会被后续采样复用。`microduck-standard-61` 布局使用以下从零开始、左闭右开的切片：

| 切片 | 含义 |
|---|---|
| `[0:3]` | 陀螺仪 |
| `[3:6]` | 投影重力 |
| `[6:20]` | 相对于默认姿态的关节位置 |
| `[20:34]` | 具有一个控制步观测延迟的关节速度 |
| `[34:48]` | 上一次原始策略动作，而非限幅后的执行量 |
| `[48:51]` | 运动命令：前向／横向速度与偏航角速度 |
| `[51:55]` | 头部姿态命令 |
| `[55:61]` | 身体姿态命令 |

随附策略的轨迹执行在每个控制步使用返回的观测，将其复制后仅用请求的运动命令覆盖 `[48:51]`，同时设置环境的运动命令。传感器、上次动作及头部／身体通道保持不变，保留的原数组也不变。再次调用 `_get_obs` 会推进速度历史，消除预期延迟。会话拥有的运行在推理时使用返回观测，不执行该覆盖。Lab 模仿学习将身体命令索引 59–60 替换为 sin/cos 相位（`microduck-lab-body-phase-61`），因此相同的 61 元素宽度不证明兼容标准身体姿态控制器。观测更新频率与数组保持性不认证控制器的上游来源，也不验证其行为能力。

<a id="nominal-physics"></a>

固定种子的标称 BAM 评估关闭观测噪声、领域随机化与随机偏航，而非所有随机因素。重置仍加入由种子控制的 ±0.03 rad 关节扰动及 `[0, 0.01)` m 根部高度抬升，将速度归零，并在该扰动姿态初始化控制量。`standing_spawns=True` 跳过特殊初始姿态类别，不会使机器人静置稳定或求解站立平衡。BAM 保留启动时的电池电压与压降增益采样，并在每个物理子步抽取 3–6 个物理步的延迟（当前 0.005 秒物理间隔下为 15–30 ms，启动时受可用历史长度限制）。该延迟替代而非叠加 XML 路径独立的 0／1 控制步延迟。

每次轨迹执行构造新环境，并用相同的回合种子重置；评估使用 `seed + episodeIndex`。BAM 重新设种不会重抽构造时的电池参数，因此对用另一种子构造的环境执行重置并不等价。这些标志不完整描述重置分布、命令采样或执行器变化；仍需源码／运行时身份及记录的 BAM 设置。固定种子评估既不是无扰动初始状态，也不证明所有种子产生相同轨迹。仅下发缺少身体平衡反馈的位置参考不证明平衡；仅凭其失败不能证明目标不可行，也不能据此修改评估阈值。

## 原生姿态场景元数据

`RobotScene` 提供身体名称、带颜色的网格几何和十四个关节的顺序。其可选的 `kinematics` 成员以 `RobotSceneKinematics` 承载本地编写所需的数据；记录回放不需要该成员。MicroDuck 提供方从已安装的 MJCF 模型提取这些元数据。实时姿态舞台必须具备该成员，不会用猜测的骨架或策略记录帧代替。

| 字段 | 含义 |
|---|---|
| `rootBody`、`rootPosition` | 自由根部的身体索引及其 STAND 世界位置，单位为米。编写的根部俯仰以绕 +Y 轴的右手旋转替换其朝向；负俯仰表示后仰。 |
| `bodies` | 按 `scene.bodies` 顺序排列、父节点在前的静止变换：父索引、局部 xyz 位置及单位 wxyz 四元数。身体零是恒等世界身体。 |
| `joints` | 按 `scene.jointNames` 顺序排列的十四个不同的非根部铰链：驱动身体索引、身体局部锚点、单位轴及 `qpos0` 参考值。编写的关节值是绝对弧度，而非相对 STAND 的偏移量。 |

Python 回复解析器在发布元数据前验证向量宽度、有限数值、旋转归一化、父节点顺序及驱动身体的唯一性。浏览器正向运动学只改变渲染变换；视觉接地将最低的渲染顶点放在地面上，不改变编写的关节、根部俯仰或物理状态。这些姿态不提供实测平衡、执行器或硬件安全证据。

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

<a id="dance-assessment"></a>

## 冻结编舞评估

可选的试验 `evaluation.dance` 包含显式阈值，而非经过校准的默认值。标准与计划版本必须同为 1 或同为 2；未知或不匹配的版本会失败。版本 1 规则仍适用于历史记录和显式准入，包括已冻结但尚未启动的试验。版本 2 要求事先指定标准；不会自动升级并重写已保存计划、判定、原因或哈希。`requiredCycles` 是正整数；关节 RMSE 有十四个非负弧度阈值，一至十四个运动关节索引是 `[0,13]` 内不重复的整数，回合通过比例位于 `(0,1]`。摆幅、增益及幅度下限为正；幅度上限不能低于下限。根姿态 RMSE 与水平漂移限制非负。提供方拒绝不足以覆盖所需运行时周期的时限。

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

计划在训练前冻结原始片段及采样参考哈希、实际控制间隔、周期与动作块网格、具名关节与根刚体、物理设置及运行时和评估器身份。宿主绑定的 `dancePlanSha256` 对包含 Python 所属 `sha256` 在内的完整解码计划计算哈希；两个哈希各用自身拥有者的规范化方式，不能互换。直接舞蹈评估要求所属运行具有匹配的训练前计划及相同标准。不能事后从当前目标或阈值预设重建缺失计划。

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

两个版本都对已观测的有限子集记录关节及根姿态 RMSE 和去均值运动比值；版本 2 不会将这些字段替换为完整窗口得分。版本 1 即使覆盖不完整，也拒绝已观测片段的阈值违反。这种拒绝不证明计划窗口的每一种完整测量结果都会违反相同均值或比值阈值。

对版本 2，设 `m = measuredSteps`，`N` 为该窗口的计划采样数：周期使用 `reference.cycleSteps`，动作块使用冻结的 `endStep - startStep`。存在已观测 RMSE 时，完整窗口下界为 `observedRmse * sqrt(m / N)`。仅当此下界严格超过冻结限制时，关节或根姿态 RMSE 检查才失败。这来自未观测平方误差非负的性质；它不将缺失采样填为零误差，也不伪造完整窗口实测得分。缺失指标保持 null。

版本 2 的幅度与增益检查在 `m = N` 前不能决定失败；即使终止使窗口未完成，完整有限覆盖也允许这些检查。最大水平漂移随增加测量保持单调，可在部分覆盖时失败。未完成窗口不能通过。回合终止或提前截断独立导致失败；较低 RMSE 下界不能覆盖该结果。各周期和动作块分别按自身计划长度独立检查。

指标使用完整频率下的有限测量，而不是抽样后的查看器帧或填补空缺的数据。运动比值无量纲，目标不活动的关节保持 null。每个要求的周期和动作块都保留判定与原因。`completedCycles` 按已执行控制步数统计经过的参考时钟周期，不表示通过的编舞周期或完整有限测量覆盖。汇总舞蹈判定将通过回合数与 `minPassedEpisodeFraction` 比较；未完成回合若可能改变结果，则仍保持未决。平衡 `passed` 相互独立。[评估决策](../../.agents/notes/implemented/feature/2026-09-05-microduck-frozen-choreography-assessment.zh.md)区分此实验性测量与通用技能和硬件资格认证。

## 评估证据与重新仿真

`evaluate_trial` 解析绑定的已完成运行，并应用试验冻结的标准。探索性 `evaluate` 接受显式标准，但标准不同时不能将其呈现为预注册评估。`evaluations` 返回经过验证的完成报告，并通过单独的 `incompleteCount` 统计没有报告的准入记录。无效记录以及已配置的列表或响应限制会明确报错；它们不是空历史或成功结果。

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

报告比较描述证据，不自动评选优胜者。评估设置、观测语义、冻结物理和已加载的执行运行时来源信息必须匹配，才能进行同条件评估。任一报告包含编舞证据时，两者都必须携带相同计划身份；缺失或不同计划会阻止同条件比较。目标、参考动作、预算、学习器和种子仍是可见差异；多项改变不构成受控的单变量实验。直立比例、终止次数和可用的跟踪误差不评估完整编舞、稳健性或实机安全。

`replay_evaluation` 仅支持会话拥有的运行策略，返回 `new-resimulation`，而非原始评估帧。提供方验证报告、策略字节及当前运行时兼容性，再使用选定回合保存的种子、报告请求的时限及受支持的零命令。提前终止不会将请求时限替换为记录的回合长度。浏览器不能代入当前草稿输入，历史通过结果绝不覆盖不兼容状态。评估与探索性 Perform 时长相互独立；没有操作授权硬件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

Source: [`packages/robot/robot-lab/src/index.ts:52`](../../packages/robot/robot-lab/src/index.ts)
<!-- END GENERATED cordis-surface -->
