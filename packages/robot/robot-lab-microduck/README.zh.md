---
description: "配置本地 MicroDuck 的 CPU、MLX 或 RLX 训练，并查阅录制式仿真与策略评估的限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-robot-lab-microduck

[English](README.md) | 中文

## 概述

通过 `ctx.robotLab` 在本地使用 CPU SB3、可选的 DSH 自有 MLX GPU PPO，或单独配置的 RLX PPO 后端训练 MicroDuck。MuJoCo 物理运行在 CPU 上。配置绝对路径 `sourceRoot`（包含上游模型检出的 MicroDuck Lab 仓库）和 `pythonBin`（该 Lab 已安装的 Python 环境）。可选 `mlxPythonBin` 指定 macOS arm64 上安装 MLX 的独立 Python 3.12 环境。此包不安装依赖、不修改检出目录、不打开服务器端口、不发布策略，也不控制硬件。

## 目录

- [存储与进程所有权](#storage-and-process-ownership)
- [工作室配方与参考预览](#studio-recipes-and-reference-preview)
- [持久化学习记录](#durable-learning-records)
- [学习器选择](#learner-selection)
- [仿真与评估](#simulation-and-evaluation)
- [验证](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="storage-and-process-ownership"></a>
## 存储与进程所有权

`storageDirectory` 默认为权威会话工作区下的 `.microduck-studio`。每个会话使用以哈希命名的目录。通过 `ctx.fs` 检查文件系统包含关系；所有 Python 进程通过 `ctx.subprocess` 启动并接受完整的 `ctx.sandbox` 约束。只读会话不能启动训练。凭据不会被隐式转发。请求 JSON 不接受解释器、源码或桥接脚本路径。

训练准入在准备运行记录之前预留一个已配置的本地容量名额。`maxConcurrentTraining`、训练和操作超时、终止宽限期、输出限制、环境数量、步数、动作片段大小和奖励范围均可配置。浏览器断开连接不会取消已获准的训练。停止操作和提供方 dispose（资源释放）会终止进程树并等待完全退出。检查运行记录时，如果其所属进程不存在，则将其标记为中断；不会自动重启。

每个版本 3 manifest（元数据清单）冻结解析后的后端、配方和动作片段、依赖版本、源码及模型指纹、桥接与学习器身份、硬件及设备，以及实际生效的 BAM 参数值、来自已安装包或回退值的来源选择和哈希。`bridgeSha256` 对随包提供的 `bridge.py`、`studio.py` 与 `dance_metrics.py` 运行时代码组合计算哈希；学习器辅助代码哈希单独记录。重新加载时拒绝 BAM 参数值或来源选择的变化；构造环境时复用冻结值，不再打开已安装的参数数据。三个学习器都使用站立初始姿态、观测噪声、动作延迟、无辅助、无领域随机化以及选定的执行器。重新加载时检查冻结的动作片段，而不是解析行为的默认片段。随包提供的桥接脚本适配 Lab 环境工厂，无需修改其源码。

完成状态与 `policySha256` 通过一次原子 manifest 替换共同提交。Stop 结算时如果完成状态已经提交，则保留已完成策略和原始完成时间，同时仍等待整个进程树退出。在完成前停止的训练记为 `stopped`，不发布策略。当前会话拥有的策略必须具有已完成的运行记录和匹配的冻结哈希，否则无法加载。ONNX Runtime 执行经过验证的同一份内存字节，不会重新打开文件路径。产物包括内嵌归一化的 `policy.onnx`、私有训练检查点、进度和评估证据。不接受上传的 pickle 检查点。

对于 `run` 和 `runs`，进程拥有者状态核对保留已从桥接响应解析的进度采样，同时采用权威运行记录的其余字段，包括终态、完成时间和策略身份。进度仍可为 null，且只表示某一时点：它可能落后于已提交的完成状态，不保证是最新采样。完成不会合成最终步数，也不会使进度成为策略发布的权威依据。

可选 RLX 进度记录累积的已完成采集／更新区间、rollout／更新对，以及完整完成更新内的实际小批次优化器步数。计数与计时不含未完成或失败阶段中的部分工作；一次更新可能执行小批次后失败，却不增加任何报告的优化器步数。其最近平均损失对最后一次完整完成更新的加权总小批次目标求均值，不是分开的策略／价值／熵损失，在一次更新完整完成前保持 null。采集墙钟时间包括环境调用与推理；更新墙钟时间包括 GAE、延迟执行的价值网络计算与优化器工作。两者都不隔离 CPU 物理或 GPU 计算，传输时间没有测量值。检查点序列化和 ONNX／一致性验证导出各有独立可空计时，仅在相应操作成功后填入；它们不计入训练 `elapsedSeconds`。检查点仍不可续训。不含这些统计的运行仍可读取，缺少值表示未知而不是零。准确字段和剩余成本归因限制见[进度参考](../../../docs/subsystems/robot.zh.md#run-progress)。

<a id="studio-recipes-and-reference-preview"></a>

## 工作室配方与参考预览

`studio` 读取已安装的 MuJoCo 模型，识别 `trunk_base`、十四个有序铰链关节、实际范围和站立默认值。仅提供 MicroDuck 适配器。版本 1 的 Head Bob、Disco Groove、Side Sway、Robot Pop、Tiny March、Celebration Mix、Stand Steady、Say Hello 和 Look Around 模板都是实验性编排动作，不是已学会的技能。每个模板声明舞蹈或动作分类、编排难度和已注册的奖励行为（Stand Steady 使用 `stand`，其他动作使用 `imitate`）。每个原地模仿模板声明 `trainingWeights: {travel: 0}`；Stand Steady 不声明覆盖值。调用方将这些值与已注册奖励默认值显式合并；普通训练保持不变。这些标签和覆盖值不是策略评估结果。编译将目标限制在模型范围内并平滑过渡；相同的循环端点避免回绕时目标跳变。

推荐配方为 96 BPM、32 拍（20 秒）和 0.5 动作幅度。动作幅度限制为 [0,1]。`minStudioBpm` 和 `maxStudioBpm` 默认为 40 和 200；单模板配方的 `studioBeatChoices` 默认为 [16,32]。`studioBlockBeatChoices` 默认为 [4,8,16,32]，`maxProjectBlocks` 默认为 8；序列总拍数可为单模板预设列表以外的求和结果。`maxClipKeys`、`maxClipSeconds` 和 `maxSimulationSteps` 也限制编译和预览。音乐必须具有相同速度和拍数，并选择 `disco`、`electronic`、`lofi` 或 `chiptune`；仅持久化其版本化配方。浏览器无需音乐提供方或密钥即可生成可下载音频。

`save_project` 在会话拥有的 `projects/` 下提交不可变的版本 2 `revision-<uuid>` JSON 记录，通过 SHA256 摘要绑定完整配方、每个动作块的模板快照、解析后的训练建议、模型配置和编译片段。旧项目版本会被拒绝，不进行迁移。`projects` 和 `project` 返回存储记录前进行验证。`maxProjects` 默认保留 100 个修订；达到容量后拒绝保存，不自动清理。配方中非 null 的 `projectId` 必须指向已有的本地项目。只读会话不能保存。绑定项目的训练请求提供修订身份，以及用于选择保存片段的 `clip: null` 或完全一致的显式片段；准备阶段将解析后的片段和完整快照冻结到版本 3 的训练配方。之后保存项目不会改变已获准运行。

可选 `recipe.blocks` 在同一 BPM 下组合有序动作。首块标识顶层模板，总拍数与音乐一致，全局幅度缩放每个动作块。重新排序、移除或复制动作块会创建新的保存修订。每块在声明拍数内回到模型的中性站姿；衔接不会添加隐藏拍数或重复关键帧。编译器保留每拍八个采样，并拒绝不足的关键帧预算。`project.training` 将全 Stand 动作解析为 `stand` 和 `{}`，包括显式动作块序列；任何混合或非 Stand 动作均使用 `imitate` 和 `{travel: 0}`。消费者应将其覆盖值与行为默认值合并，而不是选择首块的行为。编译后的 `clip.name` 原样保留 `recipe.name` 的 Unicode 显示文本，包括空格和斜杠；两者均不决定项目路径。显示名称必须非空白、最多 64 个 Unicode 标量值，且不含控制字符或代理码点。训练 `spec.name` 保持 ASCII 规则。

`reference_preview` 使用 CPU MuJoCo 对冻结片段执行正向运动学，并将每个结果标记为 `kinematic-reference`。它要求 `maxSimulationSteps >= 2`，以保留零时刻和完整时长两个端点；实际仿真仍允许仅执行一步。它不执行学习策略、不积分动力学，也不证明平衡或接触可行性。运动学帧报告已知关节位置和根刚体倾角。其关节速度、根刚体世界速度、根刚体速率、控制器目标和执行器扭矩为 null，而不是实测零值或有限差分估计。策略录制帧报告实际 qpos（rad）、qvel（rad/s）、控制器目标（rad）、广义执行器扭矩（N m），以及已识别根刚体的世界线速度和速率（m/s）、倾角（rad）。不会从身体变换推断接触事件或舞蹈节奏评分。

<a id="durable-learning-records"></a>

## 持久化学习记录

宿主提供方通过已配置文件系统，在获授权的会话存储中持久化不可变的版本 1 试验、试验与运行绑定及反思记录。项目格式 2、运行格式 3 和科学计算 Python 产物保留各自格式。学习元数据不改变 Python 运行时指纹。`save_trial` 要求经 Python 验证的项目快照与有界重读结果一致，并在提交前验证完整简述、训练请求、冻结评估标准和可选父反思；它既不预留容量，也不启动 Python 训练。`train_trial` 在启动训练器前提交唯一绑定，拒绝第二次准入，并从现有监督器推导运行状态。准备或持久化失败不得启动未跟踪的训练。

`evaluate_trial` 解析绑定的已完成运行，使用其策略与试验冻结的评估标准。`evaluations` 验证保存的准入记录及完成报告，包括策略所有权和哈希，仅通过 `incompleteCount` 返回缺少报告的准入数量。`save_reflection` 拒绝缺失、跨会话、不匹配或被篡改的试验与报告引用，且仅在标准匹配试验冻结配方时绑定报告哈希及实际策略字节。新试验可引用该不可变反思；读取祖先记录时验证全部引用证据并拒绝循环。草稿不是持久化谱系。`maxTrials`、`maxReflections`、`maxEvaluationRecords`、`maxLearningRecordBytes` 和 `maxLearningTextLength` 限制保留历史的读取与学习记录；[提供方配置](src/index.ts)定义其范围。记录与完整响应限制会明确报错，不会清理证据或制造空历史。

`replay_evaluation` 仅支持会话拥有的已完成运行策略。它验证保存报告与策略，选择报告中记录的回合种子，并用报告请求的 `stepsPerEpisode` 及受支持的零命令调用现有仿真器。它不将请求缩短为提前终止回合的实际步数，也不使用当前草稿设置。结果是**新的重新仿真**，而非原始录制；即使历史评估通过，运行时不兼容仍会阻止执行。

<a id="learner-selection"></a>

## 学习器选择

训练接受 `backend: "cpu" | "mlx" | "rlx"`；省略时在准入前解析为 CPU。就绪检查分别报告每个后端的可用性、原因、`learnerDevice` 和 `physicsDevice`。所选后端不可用时绝不回退到其他学习器。CPU 使用 Lab 原有的 SB3 配方。MLX 使用原创 `dsh-mlx-ppo-v1` 配方，而非 RLX 或 EnvPool：Metal 执行策略与价值学习，CPU 执行 MuJoCo/BAM 物理，不使用对称性先验，也不承诺提速。CPU 工作进程在初始化 MLX 或 Torch 前 fork；Metal 探测使用独立进程。

MLX 保存原始高斯样本及其对数概率；环境对实际执行的动作限幅，同时观测原始动作。导出返回确定性的原始均值，内嵌冻结的观测归一化：使用 float64 执行减法、除法和限幅，再转换为 float32 策略输入，与训练的 `VecNormalize` 一致。导出一致性检查使用实际冻结的环境归一化器，而不是另一套面向导出的实现。超时自举使用终止观测，两种终止状态均阻止 GAE 跨重置传播。CPU 采样与导出保留原有动作语义。MLX 数值快照不是可恢复检查点。ONNX 发布必须通过 CPU Runtime 与冻结 Metal 策略的输出一致性检查；推理不需要 MLX，但仍检查产物、辅助代码、运行时、源码和物理来源信息。

### RLX PPO

`rlx` 从已配置的 RLX 检出导入 PPO、模型、轨迹缓冲区和观测适配器；它不选择 `dsh-mlx-ppo-v1`。将 `rlxPythonBin` 和 `rlxSourceRoot` 同时设为绝对路径，或同时留空。解释器要求 macOS arm64 上的 Python 3.12、可用的 MLX Metal、RLX 依赖及本地仿真器依赖。配置不会安装或修改任一检出。[发布包](package.json)包含 `python/rlx_ppo.py`；RLX 和仿真器仍需单独安装。就绪检查探测导入与小型 Metal 运算，不验证学会的动作。

提供方的 `rlxPpo` 对象配置轨迹时限、小批次、轮数、学习率、折扣、GAE、PPO 损失、梯度限制、观测归一化及最短回合时长；[配置定义](src/rlx-config.ts)负责默认值和范围。准入冻结解析后的 `rlx-microduck-ppo-v1` 配方，对 RLX Python 源码及依赖声明（包括未提交内容）计算哈希，解析可整除的小批次数，并记录请求步数与按完整轨迹收集的步数。取整后的采样量不能超过 `maxTrainingSteps`。回合时长覆盖冻结片段及配置的最短时长，并根据已安装仿真器的 `CTRL_DT` 向上取整到完整步数。配方记录 `requestedEpisodeSeconds`、`controlDtSeconds`、`episodeSteps` 及实际 `episodeSeconds`；实际时长绝不缩短请求动作。CPU 工作进程先于 MLX 或 Torch 初始化启动。

RLX 超时自举使用终止状态价值，不让 GAE 跨重置传播；真正终止的自举值为零。终止观测使用适配器当前的归一化统计量，不再次更新统计量。原始高斯动作保留匹配的对数概率；导出动作保持原始确定性均值，不对输出统一限幅。导出在 float32 策略网络之前保留实际适配器的 float64 归一化，并要求 CPU ONNX Runtime 与该策略网络通过一致性检查，探针包括已采集观测及归一化边界值。

已完成的 RLX 运行通过 `artifactSha256` 绑定 `rlx-artifacts.json`。其中的哈希绑定数值检查点、JSON 元数据、全精度 `normalizer.npz`、`export-parity.json` 和最终 `policy.onnx`；成员缺失或变化会阻止加载。导出及产物验证后，RLX 完成流程在提交 `completed` 前重新检查冻结的源码、辅助代码、模型、运行时、BAM 和片段身份。即使导出成功，不匹配也会记为失败，而非发布已完成策略。应保留完整运行目录，而不只是 ONNX 文件。这些推理产物不包含可用于续训的优化器、随机数生成器或环境状态。[RLX 后端决策](../../../.agents/notes/implemented/feature/2026-09-05-microduck-rlx-backend.zh.md)记录独立学习器身份及导出要求。

`rlx.safetensors.json` 在 `metadata.trainingDiagnostics` 中保存有界的版本 1 采集诊断。诊断分别汇总真正终止与时限截断的已完成回合长度（计数、总和、最小值、最大值与十一个固定直方图区间，包含上界及溢出区间），并记录最大已观测回合年龄及每个环境一个右删失的未完成长度。长度以控制步计；尾部长度为零表示没有活跃的未完成步数，不是额外的已完成回合。`collectionComplete` 只表示已观测转移数等于准入采集预算，不表示优化或导出已完成，也不证明学会技能。

`referenceExposure` 用 32 个区间统计从源码语义推导的步后奖励参考索引，采用显式自有片段的实际运行时网格。其 `elapsedReferenceTraversals` 统计经过的参考时钟遍历次数，不是实测策略相位、跟踪或成功动作。没有显式片段时，暴露统计不可用；默认行为的参考未被测量。已完成运行通过已有产物哈希绑定检查点元数据。原始 `progress.jsonl` 按已有采样频率保存 `trainingDiagnostics` 前缀；即使前缀已达到采集预算，它也不绑定策略。旧检查点中缺少诊断表示不可用，而不是零。这些诊断不投影到公开的 `RobotProgress` 或 UI，不改变评估标准，也不提供经过能力验证的预设。

### DSH 自有 MLX 配置

若需配置可选的 DSH 自有 MLX 解释器且不修改两个外部环境，请将 `LAB` 和 `DSH` 设置为绝对检出路径，然后运行：

```sh
UV_PROJECT_ENVIRONMENT="$DSH/.artifacts/microduck-mlx-env" uv sync --frozen --project "$LAB/microduck_local" --python 3.12 --no-editable
uv pip install --python "$DSH/.artifacts/microduck-mlx-env/bin/python" 'mlx==0.31.1'
```

将 `mlxPythonBin` 指向该解释器。MLX 0.31.1 解析匹配的 Metal 包；无需安装 RLX、EnvPool 或全局 Qt。安装必须显式执行，训练请求不会触发安装。

<a id="simulation-and-evaluation"></a>

## 仿真与评估

请求中的 `steps` 或 `stepsPerEpisode` 独立于行为的训练回合长度设置轨迹时限。在 50 Hz 下，1,000 步请求 20 秒，默认 `maxSimulationSteps` 为 1,500，允许 30 秒。跌倒和非有限状态仍会提前终止回合。训练时限和参考片段周期保持不变；循环参考目标不等于重复已录制的帧。

策略发现验证受支持的已完成 manifest 和 ONNX 哈希，同时单独报告 `runtimeCompatibility`。桥接脚本、源码、依赖或 BAM 变化后，完整的版本 3 产物仍会列出并附带不兼容原因；原始来源信息和评估证据不会被重写。`runs` 将不受支持的磁盘版本分离到 `incompatibleRuns` 诊断中，不解释其配方或产物。这些文件保持不变，不参与策略发现；直接查询运行或执行请求会被拒绝。仿真和评估重新检查兼容性，在推理前拒绝不兼容产物。应恢复原运行时或训练新实验，而不是修改冻结哈希。

`scene` 返回真实 MuJoCo 网格。`simulate` 加载指定的导出策略，返回包含身体变换的有界、固定种子 BAM 轨迹；这是录制式仿真，不是实时控制。只能选择随附的行走、站立策略以及当前会话拥有的已完成运行策略。仿真和评估记录实际生效的 BAM 参数值、关闭的观测噪声、启用的动作延迟，以及关闭的领域随机化和随机偏航。仿真和每个评估回合还报告采样的电池电压、压降增益、固件限制、摩擦系数和延迟设置。标称标志不保证无扰动或已静置稳定的站立初始状态：固定种子的重置扰动、BAM 电池／压降采样和动作延迟仍然启用。[标称物理语义](../../../docs/subsystems/robot.zh.md#nominal-physics)定义这些采样及新环境构造与重置之间的种子关系。

随附策略推理保留环境返回的标准 61 维观测及其一个控制步的速度延迟，仅在副本上覆盖请求的运动命令；会话拥有的运行推理直接使用返回观测。它不会为更新命令而重建观测。[观测参考](../../../docs/subsystems/robot.zh.md#policy-observations)定义切片、数组生命周期及身体相位不兼容性。更新频率检查不证明上游策略来源、站立平衡或舞蹈可行性。

每次评估都在会话存储的 `evaluations/` 下预留不可变的 `eval-<uuid>` 目录。在任何轨迹执行前，`request.json` 记录传入的完整规格和标准、精确策略哈希、物理设置、身份及准入时间。对应的 `report.json` 包含实测回合、可选姿态 RMSE 和传入标准的判定结果。并发调用使用不同的目录以及独占创建、随机命名的临时文件。所有准入记录和报告都会保留，包括随附策略的证据；中断的尝试保留准入记录，不产生完成报告。`verification: evaluated` 表示存在针对该策略字节的报告，而非其标准已通过。通过终止次数和直立标准既不证明舞蹈编排已完成，也不证明实机安全。

### 显式编舞评估

启动前，在绑定项目的试验中保存完整的 `evaluation.dance` 标准。准入将实际仿真参考网格、评估输入、物理设置和评估器身份解析为 `run.dancePlan`。宿主使用自身规范化哈希，对**包含不透明 Python `sha256` 在内的完整解码计划**计算并提交 `binding.dancePlanSha256`。它不替换或重新计算 Python 摘要；后续语义变化即使保留原摘要字符串也会失败。直接舞蹈评估要求匹配的训练前运行计划及相同评估输入，不能事后引入默认值。

每个要求的周期和编排动作块都使用完整控制频率下的有限关节、根刚体姿态与位置测量评分。报告将关节及根姿态 RMSE、动作幅度、参考匹配增益和水平漂移与平衡分开。缺失采样保持缺失；目标值或重复帧不会填补空缺，也不会通过时间对齐掩盖相位误差。`passed` 仍仅表示传入的直立与终止标准；`danceStatus` 独立报告通过、失败或未完成。没有舞蹈标准的报告表示未评估编舞。

标准与计划版本必须同为 1 或 2；不支持的版本会失败。版本 1 保留对已观测片段的阈值拒绝规则。版本 2 保留所记录的子集指标，但使用计划完整窗口的 RMSE 下界判定部分测量是否必然失败；即使执行终止，幅度与增益也只有在全部计划有限测量可用时才能判定失败。最大漂移在部分覆盖时仍可决定失败。未完成窗口不能通过；回合终止与提前截断独立导致失败。各周期与动作块分别使用自身计划长度。[记录参考](../../../docs/subsystems/robot.zh.md#dance-assessment)定义下界。冻结的版本 1 试验仍可准入，不会升级；已保存计划、判定、原因与哈希都不会被重写。

冻结参考同时公开编排时长及实际控制网格周期时长。请求的评估必须覆盖全部要求的运行时周期：50 Hz 下两个 20 秒周期至少需要请求 2,000 步，且 `maxSimulationSteps` 至少配置为 2,000；默认的 1,500 步不足。舞蹈预检使用仅依赖标准库的辅助代码，不在 RLX 工作进程 fork 前初始化数值运行时；准入、评估及已完成策略发布前会重新计算数值参考。[编舞决策](../../../.agents/notes/implemented/feature/2026-09-05-microduck-frozen-choreography-assessment.zh.md)记录这些实验性证据限制。时序资格验证、独立对照和鲁棒性测试仍是单独工作；通过不认证通用技能已学会或硬件安全。

Lab 模仿学习将 sin/cos 相位存入身体命令观测索引 59–60。`microduck-lab-body-phase-61` 策略不兼容机器人的标准身体俯仰和偏航语义。`prepare` 始终返回 `allowed: false`；动作片段策略还会获得额外的相位不匹配原因。不存在可启用实机部署的 API 绕过路径。

<a id="verification"></a>

## 验证

<details>
<summary>维护者检查——点击展开</summary>

[桥接回归测试](tests/test_bridge.py)检查返回观测的对象身份、随附命令在副本上的覆盖，以及非命令通道的保留。[可选 CPU 更新频率检查](tests/test_rollout_observations.py)在已安装的 Lab 解释器下使用 `ROBOT_BRIDGE_SOURCE`，执行四个固定动作 BAM 步，不加载策略或训练；没有该变量时显式跳过。这些检查覆盖观测生命周期与速度延迟，不验证控制器的平衡、舞蹈能力或上游来源。

RLX [辅助测试](tests/test_rlx_ppo.py)覆盖源码指纹、数值配置、产物绑定和实际归一化器导出。可选数值测试要求 `ROBOT_RLX_NUMERIC=1` 和绝对路径 `ROBOT_RLX_SOURCE`。单独的 [RLX 桥接冒烟测试](tests/smoke_rlx.py)在选定 RLX 解释器下接受 `--source`、`--rlx-source` 和新的 `--output` 目录。它使用两个环境，执行四步的已保存 Head Bob 运行和八步的时间限制运行。这些有界检查不证明已经学会编舞，也不证明宿主沙箱组合或浏览器操作可用。

使用 `python -B packages/robot/robot-lab-microduck/tests/test_bridge.py` 运行无需依赖的桥接测试；`tests/test_mlx_ppo.py` 还需要 NumPy，并在 MLX 和 ONNX Runtime 可用时启用数值与导出检查。可选的真实冒烟测试在选定解释器下运行 `tests/smoke.py --source <absolute-lab> --output <workspace-directory> --backend cpu|mlx --steps 32`。`--inference-python <cpu-interpreter>` 验证导出的 MLX 策略可在未安装 MLX 的环境中运行。它训练一个小幅头部摇摆参考动作，导出并重新加载同一策略，执行仿真和评估，并验证部署被阻止。其短训练预算仅用于集成检查，不能证明已经学会有用的舞蹈。

`tests/test_studio.py` 覆盖不可变项目文件和模型限制验证；设置 `ROBOT_STUDIO_SOURCE` 可启用真实 CPU 目录、参考预览、遥测和冻结项目训练导出检查。使用已安装的解释器，并设置提供方相同的 `OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1` 环境。`tests/studio-process.spec.ts` 通过 `DSH_MICRODUCK_SOURCE_ROOT` 和 `DSH_MICRODUCK_PYTHON` 指定环境，在不训练的情况下用 TypeScript 解析器验证实际 Python 响应。

可选的 `pnpm run test:e2e packages/robot/robot-lab-microduck/tests/provider.e2e.ts` 使用真实 Loader、Agent、提供方、子进程服务和工作区沙箱。将 `DSH_MICRODUCK_SOURCE_ROOT` 与 `DSH_MICRODUCK_PYTHON` 设置为已安装路径；缺少任意一个时跳过。可选 `DSH_MICRODUCK_BACKEND=mlx` 和 `DSH_MICRODUCK_MLX_PYTHON` 选择 32 步 Metal 训练与 CPU 推理冒烟测试；CPU 默认为 1,024 步。`DSH_MICRODUCK_BACKEND=rlx`、`DSH_MICRODUCK_RLX_PYTHON` 和 `DSH_MICRODUCK_RLX_SOURCE_ROOT` 选择 32 步 RLX 变体。所请求的可选后端缺少路径时失败，不会回退。它检查训练、持久化 ONNX 哈希身份、仿真、评估记录和部署阻断，不需要模型密钥或硬件连接。

单独的 macOS [生命周期测试](tests/lifecycle.e2e.ts)要求 `DSH_MICRODUCK_LIFECYCLE=1`，以及四个已安装路径变量：`DSH_MICRODUCK_SOURCE_ROOT`、`DSH_MICRODUCK_PYTHON`、`DSH_MICRODUCK_RLX_SOURCE_ROOT` 和 `DSH_MICRODUCK_RLX_PYTHON`。其测试目标包括普通 Stop、仅主动终止自身拥有的 CPU 工作进程后执行 Stop、无存活进程或已发布策略，以及新运行复用容量。这是显式启用的故障注入测试，不是自动恢复失效工作进程或从检查点续训。

</details>

<a id="model-experience"></a>

## Model Experience

### 实测结果与诊断

#### 模型看到什么

`robot_lab` 工具消费者汇总此提供方的实测结果和失败诊断。仿真标记为 `recorded-simulation`；部署准备返回 `allowed: false`。提供方不注入消息。新评估报告包含原文限制 `The domain-randomization flag was disabled; seeded reset and BAM variation remain. No physical trial was performed.`，区分关闭的标志与仍在进行的固定种子采样；详见[标称物理](../../../docs/subsystems/robot.zh.md#nominal-physics)。[预期限制文本](tests/expected/evaluation-limitations.json)固定返回与存储的措辞；已有报告保留原记录文本。

#### Token 影响

消费者控制结果摘要及其字节预算；完整网格和轨迹帧不是由此提供方发出的模型消息。

#### KV Cache effect

无；此包既不组装也不发送模型提供方请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 不提供实时流、姿态求解 API、热启动或微调操作、付费 GPU 启动器、发布、硬件安装或激活。
- 编舞阈值是显式实验性标准，不是经过校准的通用舞蹈完成标准。评估不包含随机化扫描、执行器限制评分、独立零动作对照或视频与接触图捕获。倒立行为需要不同的标准。
- 源码、桥接脚本或运行时依赖变化后，必须恢复匹配的环境才能重放。仅支持版本 3 运行记录；旧格式既不迁移，也不执行。
- MLX 加速学习器，而不是机器人物理。其配方不与 SB3 数值等价；性能和行为质量需要针对具体任务测量。
- 产物会保留，不会自动清理。桥接响应超过已配置的输出限制时操作失败。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

不发布不变量伴随模块，因为此提供方不公开供单独检查的跨插件事件关系。准入、桥接回复和产物兼容性校验在各自所属操作中执行。

</details>
