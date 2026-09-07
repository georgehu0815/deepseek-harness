---
description: "使用会话拥有的 Robot Lab 操作编排项目、执行本地训练与录制式仿真，并查看评估证据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-robot-lab

[English](README.md) | 中文

## 概述

通过 `ctx.robotLab` 上的 Robot Lab Service Definition 使用会话拥有的环境就绪检查、已注册行为、几何数据、策略发现、训练、录制式仿真、评估和部署准备。一个作用域随 effect 管理的提供方实现这些操作。浏览器 Remote 和工具通过 `execute(agent, request, signal)` 传入具有权威身份的 agent（智能体）；请求不能选择文件系统根目录，也不能调用提供方内部操作。

## 目录

- [就绪状态与策略兼容性](#readiness-and-policy-compatibility)
- [编排工作室项目](#authored-studio-projects)
- [学习试验与证据](#learning-trials-and-evidence)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="readiness-and-policy-compatibility"></a>

## 就绪状态与策略兼容性

`./types` 中的 JSON 记录区分标准 MicroDuck 观测与 Lab 身体字段相位观测。当前策略配置具有 61 个观测量和 14 个动作量；仅凭张量宽度无法确认部署兼容性。未配置提供方时，就绪检查返回禁用的能力；其他操作均失败。重复注册提供方会失败，释放注册会移除该提供方。

训练请求接受可选 `backend: "cpu" | "mlx" | "rlx"`；提供方将省略值解析为 CPU，并在新运行记录中保存后端选择。`mlx` 标识 DSH 自有 PPO；`rlx` 标识已配置 RLX 检出中的 PPO。就绪检查包含每个后端的可用性、失败原因，以及独立的学习器和物理设备。所选后端不可用时失败，不会替换为其他学习器。`RobotRun` 仅表示格式 3 记录，始终包含 `spec.backend`。已完成的 RLX 运行还要求 `artifactSha256`，通过产物 manifest（元数据清单）绑定检查点、元数据、全精度归一化器、一致性证据和策略。运行发现通过独立的 `incompatibleRuns` 返回不支持的版本诊断，不会重建旧配方。

可选的 `RobotRun.progress.rlx` 公开 RLX 完整完成更新内的优化器步数及已完成阶段计时，不改变仅计训练的 `elapsedSeconds` 时钟。未完成或失败阶段中的部分工作不计入；报告零步不证明没有执行优化器工作。缺少统计仍表示未知而不是零，不含统计的运行仍可读取。这些采样观测可能滞后，不授权策略发布，也不证明学会技能。[进度参考](../../../docs/subsystems/robot.zh.md#run-progress)定义测量区间、损失含义及未计成本。

策略元数据将历史 `verification` 证据与 `runtimeCompatibility` 分开；后者报告完整产物是否能在当前提供方运行时中执行，并在不能执行时说明原因。列出产物不代表授权仿真或硬件部署；执行时会重新检查兼容性。

<a id="authored-studio-projects"></a>

## 编排工作室项目

`studio` 独立于可选学习器的可用性，返回已安装模型配置、实际关节限制和根刚体身份，以及版本化的实验性模板。`save_project` 验证完整配方并创建不可变修订；`projects` 列出修订，`project` 通过不透明的 `projectRevisionId` 获取单个修订。配方绑定速度、拍数、动作幅度和版本 1 的 `RobotMusicRecipe`；音频合成留在浏览器端。模板提供 `category`、编排难度 `difficulty`、已注册的 `behaviorId` 和显式 `trainingWeights`；消费者将冻结的覆盖值与行为目录中的奖励默认值合并。提供方不会把模板权重隐式应用于训练请求。目录条目不表示训练策略已能执行该动作。项目和片段显示名称原样保留完全相同的 Unicode 文本，包括空格和斜杠（非空白、最多 64 个 Unicode 标量值、不含控制字符或代理码点）；它们不用于选择文件系统路径。训练 `spec.name` 保持 ASCII 标识规则。

可选的有序 `recipe.blocks` 数组支持对 `{templateId,templateVersion:1,beats,moveSize}` 条目重新排序、移除和复制，再保存为新修订。首个动作块必须匹配顶层模板；动作块拍数总和必须等于动作与音乐拍数，全局幅度与各块幅度相乘。版本 2 修订冻结有效 `blocks` 和整个动作的 `training: {behaviorId,weights}`。全 Stand 动作即使显式提供动作块，也解析为 `stand` 和 `{}`；任何混合或非 Stand 动作均解析为 `imitate` 和 `{travel: 0}`。序列训练应采用该建议，而不是首块的行为；不支持的项目版本会被拒绝。

`reference_preview` 为保存的修订返回 `kinematic-reference` MuJoCo 姿态，不是策略轨迹，也不是动力学可行性的证据。`simulate` 仍为 `recorded-simulation`。参考帧提供已知关节位置和根刚体倾角；关节及根刚体速度、根刚体速率、控制器目标和执行器扭矩因未测量而为 null。录制仿真帧提供实际仿真器状态，并明确关节、执行器和已识别根刚体的单位。消费者必须保留模式区别，不能将直立评估通过解释为舞蹈编排认证。

训练请求可绑定 `projectRevisionId`，通过 `clip: null` 选择已保存片段，也可提供完全一致的片段。准入解析该不可变修订，并将 `projectSnapshot` 存入运行配方；调用方不能提供此快照。准入后，训练不会查找可变项目或重新编译模板。普通训练仍接受显式动作片段或 null，并独立解析后端。

<a id="learning-trials-and-evidence"></a>

## 学习试验与证据

`save_trial` 提交 `RobotTrialRecipe` 后，`train_trial` 才能启动它。配方要求已保存项目和 `clip: null`、四个学习简述字符串（`goal`、`prediction`、`plannedChange`、`evidence`）、评估标准，以及显式可空的 `parentReflectionId`。简述中的证据是测量计划，不是结果。每次试验最多准入一个运行；`trials` 从绑定和权威运行推导状态，不存储第二套生命周期。仅保存不会预留训练容量。

`evaluate_trial` 使用冻结标准及该试验已完成的导出策略。`evaluations` 返回经过验证的完成报告与单独的 `incompleteCount`，不会为中断的准入记录制造成功占位结果。`save_reflection` 将观察、解释和下一项改变绑定到匹配同一试验冻结标准、运行及策略字节的实际报告；`reflections` 重新加载已提交记录。改进草稿在新的 `save_trial` 提交其 `parentReflectionId` 前尚未保存；它绝不修改父记录或从父检查点续训。

试验可以显式提供版本 1 或 2 的 `evaluation.dance` 及全部阈值；没有编舞默认标准。计划与标准版本必须匹配。显式版本 1 准入仍受支持，包括已冻结但尚未启动的试验；准入和历史读取都不会自动升级它们。训练器启动前，提供方解析独立于策略的 `RobotDancePlan`，并将完整解码计划绑定到该试验。带舞蹈标准的直接 `evaluate` 要求所属运行具有同一个训练前计划及相同评估输入；不能事后补充计划。报告保留仅评判平衡的 `passed` 标志，独立报告 `danceStatus: 'passed' | 'failed' | 'incomplete'`、控制频率下的周期与动作块测量，以及冻结参考身份。缺少舞蹈标准表示没有评估编舞，而不是通过。这些实验性标准不是通用技能或硬件资格认证。

`replay_evaluation` 按从零开始的索引选择已保存回合，返回 `mode: 'new-resimulation'`：使用报告中的种子与请求时限进行新仿真，而不是原始评估帧。仅会话拥有的运行策略支持此操作；执行重新检查策略字节和运行时兼容性。[记录参考](../../../docs/subsystems/robot.zh.md)定义共享类型与证据语义。

<a id="model-experience"></a>

## Model Experience

### 操作结果

#### 模型看到什么

`robot_lab` 工具消费者汇总此服务返回的 `RobotLabResult` 记录。此服务不构造模型消息；没有提供方时，就绪检查报告禁用的能力，其他操作失败。

#### Token 影响

只有消费者记录的工具结果会增加上下文；此服务不注入消息或 schema。

#### KV Cache effect

无；此包既不组装也不发送模型提供方请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 本地提供方不支持实机部署、付费 GPU 训练、上传检查点或重启后自动继续训练。
- 仿真响应包含有界的录制式轨迹，而非连续实时遥测。消费者必须保留 `recorded-simulation` 标签。
- 运行记录格式和观测语义配置是显式的；不承诺兼容早期实验产物。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布不变量伴随模块，因为此服务拥有提供方注册与请求分派，而不拥有独立的实验日志或产物存储。

</details>
