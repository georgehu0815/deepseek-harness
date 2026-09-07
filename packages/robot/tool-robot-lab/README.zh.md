---
description: "使用 robot_lab 工具编排 MicroDuck 项目、请求本地实验并查看有界评估证据，不激活硬件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-robot-lab

[English](README.md) | 中文

## 概述

通过此包在 `ctx.robotLab` 上注册的 `robot_lab` 工具发送会话拥有的 JSON 操作。其 `request_json` 接受公开的就绪检查、目录、几何数据、策略、运行记录、训练、停止、仿真、评估和部署准备请求。执行器在调用提供方之前验证公开操作名称；不能调用桥接脚本内部命令。没有任何操作会激活硬件。

## 目录

- [学习器就绪状态与进度](#learner-readiness-and-progress)
- [编排工作室项目](#authored-studio-projects)
- [学习试验与证据](#learning-trials-and-evidence)
- [结果限制](#result-limits)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="learner-readiness-and-progress"></a>

## 学习器就绪状态与进度

训练可指定 `spec.backend: "cpu" | "mlx" | "rlx"`；省略时选择 CPU。`mlx` 选择 DSH 自有 PPO；`rlx` 选择已配置的 RLX PPO。请求任一可选 Metal 学习器前，应检查所选后端的就绪状态。机器人物理始终在 CPU 上运行；学习器不可用时返回错误，不会回退。解释器路径、RLX 源码选择和 PPO 部署设置属于[提供方配置](../robot-lab-microduck/README.zh.md)，不属于请求 JSON。

运行结果中可选的 `progress.rlx` 报告已完成阶段计时、完整完成更新内的实际优化器步数，以及最后一次完整完成更新的平均加权总 PPO 目标。未完成或失败阶段中的部分工作不计入，因此报告零步不证明没有执行优化器工作。缺少统计表示未知而不是零。这些观测既不是技能证据，也不是独立设备或传输成本；[进度参考](../../../docs/subsystems/robot.zh.md#run-progress)定义其范围。它们使用现有工具结果记录，不是新的请求操作。

<a id="authored-studio-projects"></a>

## 编排工作室项目

`studio` 提供实际模型元数据和实验性模板，包括动作 Stand Steady（`stand`）、Say Hello（`hello`）和 Look Around（`look-around`）。`save_project` 将完整动作与音乐配方持久化为不可变修订；`projects` 和 `project` 查看保存的修订。`reference_preview` 明确报告运动学姿态，不是学习策略执行结果。可选 `recipe.blocks` 通过新的不可变修订支持有序动作编辑。项目摘要保留身份、配方、有效动作块、整个动作的训练建议和片段大小，不输出完整目标。`clip.name` 与 Unicode 显示文本 `recipe.name` 完全一致；ASCII 训练名称使用 `"project-" + project.id`，并将 `project.training.weights` 与 `project.training.behaviorId` 对应的默认值合并。绑定项目的训练可传入 `projectRevisionId`，以 `clip: null` 选择保存片段，也可提供完全一致的显式片段；由提供方而非调用方解析并冻结快照。

<a id="learning-trials-and-evidence"></a>

## 学习试验与证据

引导式实验先通过 `save_trial` 提交必须关联项目的配方，包含 `clip: null`、四字符串学习简述、冻结评估标准和可空的 `parentReflectionId`；随后由 `train_trial` 启动其唯一绑定运行。`evaluate_trial` 应用保存的标准，而不是当前草稿设置。`trials`、`evaluations` 和 `reflections` 重新加载会话拥有的证据；未完成评估准入单独计数。`save_reflection` 将学习者的观察、解释和下一项改变绑定到实际匹配报告。改进在另一次 `save_trial` 提交父反思引用前仍是未保存草稿。

进行实验性编舞评估时，在保存试验时提供完整的 `recipe.evaluation.dance` 标准，再使用 `train_trial` 和 `evaluate_trial`。提供方在训练前冻结科学评估计划；直接 `evaluate` 只有在全部评估输入匹配所属运行计划时才能使用舞蹈标准。显式 `dance.version` 选择版本 1 或 2，且必须匹配冻结计划；不会推断阈值、自动升级或事后补充计划。版本 1 拒绝已观测片段的超限；版本 2 对部分覆盖使用完整窗口 RMSE 下界，并将运动比值判定推迟到全部计划测量可用时。应分别读取平衡 `passed` 与编舞 `danceStatus`；测量不完整或没有评估编舞都不是成功。[记录参考](../../../docs/subsystems/robot.zh.md)定义阈值字段与测量单位。

`replay_evaluation` 接受 `evaluationId` 和从零开始的 `episodeIndex`。它为会话拥有的运行策略，根据保存的种子及请求时限返回明确标识的新仿真，不是原始评估帧或硬件控制。证据缺失、不匹配、被篡改或运行时不兼容时操作失败。准确的请求与结果类型见[服务记录](../../../docs/subsystems/robot.zh.md)。

<a id="result-limits"></a>

## 结果限制

`maxResultBytes` 限制包含外层包装的完整结构化工具结果。几何数据和录制帧会转换为与模型相关的计数和摘要，而不是大量数值；浏览器仍接收完整服务结果。训练响应概述动作片段的身份和大小，不重复每个关节目标。结果超过已配置字节预算时，会返回要求缩小请求范围的诊断。

<a id="model-experience"></a>

## Model Experience

### Robot Lab 操作

#### What the model sees

`robot_lab` schema 描述支持的 JSON 操作和必需字段。结果包含真实的就绪失败、不可变运行身份、实测评估结果或部署被阻止的原因。视觉结果明确标为录制式仿真，而不是实时硬件遥测。调用工具必须有所属 agent（智能体）会话。

#### Token effect

schema 带来固定的提示词开销。每条已记录结果添加有界 JSON 文本；模型可见摘要不包含几何数据、帧数组或完整动作关键帧。

#### KV Cache effect

结果追加到现有对话。此包不重写先前消息，也不发起独立模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- JSON 字符串参数是紧凑的初始操作接口，而不是针对每个操作提供独立的类型化工具。
- 此工具不附加图片或视频、不向通用任务工具注册任务、不自动轮询训练，也不向空闲 agent 会话发布完成消息。请显式检查运行记录。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布不变量伴随模块，因为此工具委托 `ctx.robotLab` 执行操作并限制模型可见结果的大小，而不拥有独立的策略状态。

</details>
