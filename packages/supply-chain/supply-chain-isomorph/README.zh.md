# @deepseek-ai/dsh-supply-chain-isomorph

[English](README.md) | 中文

供应链服务提供者：它在一次性的 Python 子进程中运行真实的 ISOMORPH 需求模拟器，并把结果返回给 `ctx.supplyChain`。仿真模型留在 Python 侧；本包是跨越该进程边界的通道以及其上的载荷转换。

## 功能说明

`apply` 在 `ctx.supplyChain` 上注册一个提供者。每次 `simulate` 调用都会以 `--simulator-root` 启动 `pythonBin` 运行 [python/isomorph_bridge.py](python/isomorph_bridge.py)，把解析后的 `SimulationConfig` 以 JSON 写入其 stdin，并从 stdout 读取一个 JSON 文档。桥接脚本把 DSH 的 camelCase 转换为模拟器的 snake_case 参数，调用 `run_demo_simulation`，并输出网络与各物料的结果。调用之间不保留任何状态：一次运行就是一个进程。

拓扑来自模拟器自身——13 个设施分布在 0 到 6 层，其中 `NewYork`（第 0 层）是需求目的地，第 6 层的源头位于上游。

## 配置

`pythonBin` 与 `simulatorRoot` 是必填项，因此配置错误的行会在加载时失败，而不是等到第一次仿真时才失败。

- `pythonBin`——能够导入该模拟器包的解释器。不提供任何默认值：正确的解释器取决于具体部署，猜错会在子进程深处才失败。
- `simulatorRoot`——包含 `simulator/demo_simulator.py` 的 ISOMORPH demo 检出目录；同时作为子进程的工作目录。
- `timeoutMs`（默认 `120000`）——单次运行的截止时间。
- `maxOutputBytes`（默认 `67108864`）——stdout 文档的字节上限。

## 默认处于休眠状态

该行在 [packages/bundle/base/cordis.patch.yml](../../bundle/base/cordis.patch.yml) 中以 `disabled: true` 发布，因为它需要一份默认安装不会提供的本地 Python 检出。启用它意味着清除 `disabled` 并从 overlay 提供两个路径。[restart-supply-chain.sh](../../../restart-supply-chain.sh) 会重建每一层，并启动一个专用的 `supply-chain` profile，其 patch 层正是这样做的，从而把与机器相关的路径挡在代码仓库之外。

## 失败报告

启动失败、非零退出、超时、超出输出上限或 stdout 无法解析，都会以 `supply_chain_simulator_failed` 的形式暴露，并携带子进程的 stderr，因此缺失依赖或未挂载的检出目录都能从工具结果中看清。

## Model Experience

### 服务提供者（无直接的模型面）

#### What the model sees

没有直接可见的内容。本包在 `ctx.supplyChain` 背后计算运行结果，不注册任何工具、提示词或 schema。模型通过 `@deepseek-ai/dsh-tool-supply-chain` 获得它的输出。它唯一对模型可见的贡献是失败信息：无法启动或非零退出的子进程，会变成该工具错误结果中携带的 `supply_chain_simulator_failed` 文本。

#### Token effect

除失败运行向调用工具的结果贡献的失败文本外，仅本包不产生任何 token 影响。

#### KV Cache effect

仅本包不产生任何影响；前缀影响由消费这些能力的工具各自拥有。

## Known Limitations and Deferred Work

- **无法在 CI 或任何默认安装中运行**——该提供者需要一份真实的本地 ISOMORPH 检出以及一个装有其依赖的 Python 解释器。集成测试在 `DSH_ISOMORPH_ROOT` 与 `DSH_ISOMORPH_PYTHON` 未同时指向两者时会自行跳过，因此引擎路径只在开发机上被执行。
- **每次运行一个进程**——没有常驻 worker，也没有批处理，因此每次调用都要付出进程启动与模拟器导入的代价。较长的时间跨度加上多个物料，耗时以秒计而非毫秒计。
- **整个结果一次性跨越边界**——运行结果是 stdout 上的一个 JSON 文档，仅受 `maxOutputBytes` 约束；没有流式传输，也没有逐日进度，因此面板无法在运行进行中展示部分结果。
- **拓扑与层级角色属于模拟器**——设施、线路与层级由 Python 模型固定，无法从 cordis.yml 配置。
