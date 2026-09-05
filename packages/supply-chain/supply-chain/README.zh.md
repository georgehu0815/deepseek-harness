# @deepseek-ai/dsh-supply-chain

[English](README.md) | 中文

供应链能力接缝：一个服务定义（`ctx.supplyChain`），用于运行多级配送网络情景、保留其结果，并派生出工具与浏览器面板读取的三份报告。它自身不拥有任何仿真模型——模型由服务提供者供给。

## 功能说明

`ctx.supplyChain` 将一次情景请求解析为完整的 `SimulationConfig`，交给已注册的提供者，保留完成的运行结果，并在其上回答报告查询。`registerProvider(provider)` 安装当前的模拟器并返回一个 disposer；若未安装任何提供者，`simulate` 抛出 `supply_chain_simulator_unavailable`。

情景默认值位于 [src/config.ts](src/config.ts)：`DEFAULT_SIMULATION_CONFIG`、五个预设（`baseline`、`demandShock`、`disruption`、`lowCapacity`、`thinSafetyStock`），以及 `CONFIG_BOUNDS`——每个字段的可接受范围，所有调用方都据此校验。`resolveConfig` 是显式的默认值填充步骤：请求在这里变成完整配置，而不是通过提供者内部隐藏的回退。

报告是对已完成运行的纯函数，位于 [src/reports.ts](src/reports.ts)，因此同一份代码同时服务于宿主工具与浏览器包：

- **node**——某个设施逐日的库存、缺货、到货与出货。
- **bullwhip**——各层级的订单方差放大倍数，即收货序列方差与出货序列方差之比（样本方差，`ddof=1`）。大于 1 表示该层级放大了它向上游传递的需求波动。
- **edge**——按平均与峰值利用率排序的每条线路，并给出达到或超过运力的天数。

## 保留策略

运行结果按插入顺序驻留在内存中，一旦超过 `maxRuns` 便按最旧优先逐出。`simulate` 仅在运行结果提交到该存储之后才发出 `supply-chain/run`，因此任何监听者都不会观察到一个服务随后无法提供的运行。

## 配置

- `maxRuns`（默认 `8`）——在逐出最旧的一条之前，保留多少条已完成的运行。

## 浏览器访问

该类继承 `TypertRemoteService`，因此面板通过生成的 Typert Remote 访问它，而不是通过会话投影：`simulate`（预设名加覆盖项，在宿主侧解析）、`run`（按 id 取一条保留的运行）以及 `catalog`（保留的运行 id、最新的 id，以及每个预设及其完整解析后的配置）。目录在宿主侧解析预设，因此浏览器不会持有第二份默认值副本。

## 导出形态

默认导出 `SupplyChainRuntime` 服务类，并将 `ctx.supplyChain` 合并进 cordis `Context`。`./types` 承载领域类型，`./config` 承载预设与边界，`./reports` 承载报告构建器；`./client` 与 `./remote` 服务于浏览器侧。

## Model Experience

### 能力接缝（无直接的模型面）

#### What the model sees

没有直接可见的内容。本包不注册任何工具，也不贡献任何提示词文本。模型只通过 `@deepseek-ai/dsh-tool-supply-chain` 触达它，相关 schema 与结果在该包中记录。

#### Token effect

仅本包不产生任何 token 影响。

#### KV Cache effect

仅本包不产生任何影响；前缀影响由消费这些能力的工具各自拥有。

## Known Limitations and Deferred Work

- **运行结果仅存于内存**——不做任何持久化，因此宿主重启会丢失全部保留的运行，浏览器面板也会从空白开始。运行一旦被 `maxRuns` 逐出即不可达，此时 `getRun` 抛出 `supply_chain_unknown_run`。
- **运行结果不进入会话日志**——面板通过请求/响应式 Remote 读取它们，因此用户运行过的情景不属于会话历史，也无法从日志重建。只有工具调用返回的内容才会抵达模型与对话记录。
- **没有默认启用的提供者**——base bundle 中 `@deepseek-ai/dsh-supply-chain-isomorph` 处于禁用状态，因此未经配置的部署会一直返回 `supply_chain_simulator_unavailable`，直到某个 overlay 启用某个提供者。
- **报告种类是固定的**——`node`、`bullwhip` 与 `edge` 即为全集；新增视图需要在此处新增构建器，而不是由提供者供给图表。
