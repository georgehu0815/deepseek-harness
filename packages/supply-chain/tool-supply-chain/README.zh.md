# @deepseek-ai/dsh-tool-supply-chain

[English](README.md) | 中文

供应链接缝面向模型的消费者：三个只读工具，分别用于运行情景、列出已运行的内容，以及读取某次运行背后的报告。本包不拥有任何仿真逻辑，也不做任何 I/O——每次调用都经由 `ctx.supplyChain`。

## 工具列表

- `supply_chain_simulate`——运行一次情景，返回各物料的满足率、需求、缺货与成本，以及运行 id。以某个 `preset` 为起点，并在其上应用各项覆盖。
- `supply_chain_runs`——列出保留的运行（最新的在最后），每条附带产生它的设置，以便在读取报告前找回运行 id。
- `supply_chain_report`——读取某次运行背后三份报告之一：`node`（需要 `nodeId` 与 `item`）、`bullwhip`（需要 `item`）或 `edge`。省略 `runId` 时读取最近一次运行。

## 数值范围写在描述里

工具 schema DSL 不支持 `minimum`/`maximum`，因此每个数值字段的可接受范围会依据 `CONFIG_BOUNDS`——即接缝用于校验的同一张表——追加到它的描述中。遵守所述范围的模型永远不会触发 `supply_chain_invalid_config`，而且由于两者读取同一来源，范围也不会与校验器产生偏差。

## 结果为何是摘要

`supply_chain_simulate` 返回服务结果而非逐日序列：一个 200 天的网络是数十 KB 的数组，对于一个关于满足率的问题而言会占满上下文。完整细节仍可通过 `supply_chain_report` 逐份报告获取。

## Model Experience

### 工具 schema

#### What the model sees

生成的 [tool-supply-chain schemas](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-supply-chain)。在目录已说明之外：每个数值参数的描述都以 `Accepted range {min} to {max}.` 结尾，且 `preset` 接受 `baseline`、`demandShock`、`disruption`、`lowCapacity` 或 `thinSafetyStock`。`disruptionEdge` 是一条两元素的 `[source, target]` 线路，且只有与非零的 `disruptionProbability` 同时给出时才生效。

#### Token effect

有条件，且受请求约束。一条 `supply_chain_simulate` 结果是每个物料一行加上运行级别的合计；`supply_chain_runs` 是每条保留运行一行，上限为接缝的 `maxRuns`。`node` 或 `bullwhip` 报告返回所指定的那一个设施或物料的逐日序列，因此其体量随运行的时间跨度增长，而非随网络规模增长。

#### KV Cache effect

仅追加：每条结果都追加到对话记录，不改写任何更早的请求 token。三份 schema 构成稳定前缀，仅在本包的工具定义发生变化时才改变。

## Known Limitations and Deferred Work

- **宿主重启后没有任何运行可被寻址**——运行 id 来自接缝的内存存储，因此模型在更早会话中见过的 id 会解析为 `supply_chain_unknown_run`。
- **运行既不能取消也不能轮询**——`supply_chain_simulate` 会阻塞整个仿真过程，且只报告最终结果，因此较长的时间跨度表现为一次没有进度的慢调用。
- **报告一次只能读一份**——比较两次运行，或跨运行比较同一个设施，都需要每份报告一次调用；没有差异比较或跨运行查询。
- **中断线路不会与拓扑核对**——`disruptionEdge` 只校验形状（恰好两个非空 id），不校验其是否存在，因此网络中不存在的线路会产出一次没有中断的运行，而不是一个参数错误。
