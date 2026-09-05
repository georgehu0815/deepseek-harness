# Agent Note: 将 ISOMORPH 供应链仿真器以插件形式移植进 DeepSeek Harness

Status: implemented

[English](2026-08-21-supply-chain-emulator-port.md) | 中文

## Problem

ISOMORPH 是一个独立的 Python 研究项目：一个多级配送仿真器、一张由此产生的网络的 Plotly/Dash 地图，以及一个同时提供两者的 FastAPI 服务器。把它的体验带入 DeepSeek Harness，意味着 harness 智能体能够运行配送情景并回答相关问题，用户也能从 Web GUI 操控这些情景，并在 3D 地球上观看网络回放——且无需启动 ISOMORPH 的服务器，也不把 harness 耦合到它的进程上。Harness 以插件方式在能力接缝之上组合一切，禁止客户端包之间直接跨插件导入，并从会话日志重建每一个模型可见的输入。一个用 TypeScript 重新实现需求模型、或从浏览器直连外部 HTTP 服务的粗糙移植，会违反其中第一条或最后一条。

## Decision

这次移植由一个能力接缝、一个提供者、一个工具消费者和一个浏览器面板构成，横跨宿主平面与浏览器平面。

**供应链接缝（`ctx.supplyChain`），宿主平面。** `@deepseek-ai/dsh-supply-chain` 是服务定义：它把情景请求解析为完整的 `SimulationConfig`，把运行委托给已注册的提供者，保留结果，并派生报告。默认值填充是在 `DEFAULT_SIMULATION_CONFIG`、五个预设（`baseline`、`demandShock`、`disruption`、`lowCapacity`、`thinSafetyStock`）与 `CONFIG_BOUNDS` 之上的显式 `resolveConfig` 步骤。运行按插入顺序保留，超过 `maxRuns`（默认 8）后按最旧优先逐出；`supply-chain/run` 仅在运行提交到该存储之后才发出。三个报告构建器——node、bullwhip、edge——是 `src/reports.ts` 中不依赖宿主的纯函数，因此浏览器包与宿主工具用同一份实现计算它们。

**模拟器以其本来面目运行。** `@deepseek-ai/dsh-supply-chain-isomorph` 是服务提供者：每次 `simulate` 都启动 `pythonBin` 运行 `python/isomorph_bridge.py`，把解析后的配置以 JSON 写入 stdin，并从 stdout 读取一个 JSON 文档。桥接脚本把 DSH 的 camelCase 转换为模拟器的 snake_case 参数并调用 `run_demo_simulation`。`pythonBin` 与 `simulatorRoot` 是没有默认值的必填 `Config`，因为正确的解释器取决于具体部署，猜错会在子进程深处才失败。该行在 `packages/bundle/base/cordis.patch.yml` 中以 `disabled: true` 发布；`restart-supply-chain.sh` 重建每一层，并启动一个专用的 `supply-chain` profile，其 patch 层启用它并提供两个路径，从而把与机器相关的绝对路径挡在代码仓库之外。

**工具返回结果，报告返回细节。** `@deepseek-ai/dsh-tool-supply-chain` 暴露 `supply_chain_simulate`、`supply_chain_runs` 与 `supply_chain_report`。由于工具 schema DSL 不支持 `minimum`/`maximum`，每个数值字段的可接受范围会依据接缝校验所用的同一张 `CONFIG_BOUNDS` 追加到它的描述中，因此所述范围不会与校验器产生偏差。`supply_chain_simulate` 返回各物料的服务结果而非逐日序列；一次 200 天的运行是数十 KB 的数组，对于一个关于满足率的问题会占满上下文，而细节仍可逐份报告获取。

**面板通过 Typert Remote 与接缝对话。** `@deepseek-ai/dsh-client-ui-supply-chain` 注册一个 `conversation.view` 条目，并调用 `simulate`、`run` 与 `catalog`。`catalog` 返回每个预设及其完整解析后的配置，因此面板以宿主拥有的值为控件初值，而不必携带第二份默认值副本。

**回放由插件体拥有。** `src/client/replayController.ts` 持有运行、连续位置与播放状态，并通过注入的 `hooks` 分区暴露给组件。用户切换到 Chat 时中栏标签页就会卸载，因此组件状态与 effect 定时器无法承载一次回放；控制器会持续推进并持续重绘地球，后者始终显示在自己的栏中。`position` 与 `day` 是两个独立发布的事实——图表读取整数天，地球读取连续位置，从而让在途货物在日边界之间插值。播放在最后一天停止而不是循环。

**网络拥有自己的 Cesium 图层。** 叠加层通过 `ctx.earthOverlays` 绘制到一个具名数据源（`Overlay:supply-chain`），该服务由 `@deepseek-ai/dsh-client-ui-geo-earth` 用 `ctx.effect` 内的 `ctx.reflect.provide` 发布。由 `GeoCommandBridge` 拥有的智能体 "Drawings" 图层是独立的数据源，从不被触碰。

**这四个包中的产品文案为英文。** 这依据用户针对本次移植的明确指示，偏离了 `packages/client/AGENTS.md`（“产品文案为中文”）。这是一个刻意的例外而非疏漏：评审者不应在未重新确认该指示的情况下把面板改回中文。代码注释与别处一样保持英文。

## Alternatives considered

**用 TypeScript 重新实现需求模型。** 这会消除 Python 依赖、可在 CI 中运行，并让整条通路统一为一种语言。被否决的原因是：这次移植的价值恰恰在于那个*真实*模型——它的提前期管道、季节性、突发与安全库存策略都是研究代码，其行为本身就是产品。重新实现将是一个披着相同名字的不同模拟器，而在一个没人能凭肉眼核对输出的系统里，任何偏差都会成为看不见的缺陷。接缝仍为将来的 TypeScript 提供者留了余地——只需一次 `registerProvider` 调用——但不假装这次移植已经有了一个。

**依赖 ISOMORPH 的 FastAPI 服务器。** 忠实且已经建好，但它要求在固定端口上运行并监管一个外部进程，把每次仿真都变成一次带有自身失败模式的网络调用，并使 harness 的行为依赖于一个它并不拥有的服务器生命周期。每次运行一个一次性子进程则没有端口、没有监管、运行之间没有共享状态，并且会带着子进程自己的 stderr 大声失败。代价是每次调用的进程启动与导入延迟，而对一个本就以秒计的时间跨度而言，这是可接受的。

**复用上游的 Plotly 图表 JSON 来做报告。** 上游 `visualize.py` 已经产出成品图表，直接发布它们本会是拿到三张图最快的路径。被否决是因为：这会把 Plotly 引入客户端包，把呈现控制权交给 Python 层，并使面板的外观取决于一个研究脚本的样式选择。返回原始序列并原生渲染，既让报告与 GUI 其余部分保持一致，又把报告数学留在一个宿主与浏览器共享的、可测试的纯模块中，还让 Python 侧只负责仿真。上游地图中承载语义而非样式的部分仍被沿用：层级角色名称、其非单调的标记尺寸，以及按物料的配色，都逐字沿用。

**把网络画进智能体既有的 "Drawings" 图层。** 它已经存在、已经接到地球上，复用它无需新增 API。被否决是因为两个图层的拥有者与生命周期不同：`GeoCommandBridge` 会在每次回放时依据 `geoCommand` 投影重建 Drawings，因此画在那里的网络会被一条无关的智能体命令抹掉，而用户的 `undo_draw` 也会删掉仿真的一部分。独立的具名数据源从构造上就让两者互不相干。

**直接从 `ui-geo-earth` 导入 `earthController`。** 面板需要在地球上绘制，而控制器就在那里。客户端包禁止跨插件导入符号，其许可的替代路径是槽位系统与 ctx 服务；槽位系统传递的是渲染，而不是一次命令式的绘制调用。发布 `ctx.earthOverlays` 让这条依赖保持为可替换的服务边，而非硬模块边，也让面板在没有 Cesium 的情况下仍可测试。

**通过会话投影把运行结果送达面板。** 这是 harness 支持的服务端到客户端推送方式，并且会让运行具备回放正确性，正如 geo 命令通路那样。被否决的原因在载荷：一次 200 天、13 节点、3 物料的运行约为 55 KB 的数值序列，而投影会把这一切写入会话日志——包括用户随手试完就丢弃的那些。请求/响应式 Remote 把探索性运行挡在持久历史之外。其代价在下文明确列出。

## Consequences

智能体可以用任意模型运行配送情景，并回答关于满足率、缺货、牛鞭放大与线路压力的问题；用户也能从 GUI 驱动同一个接缝，并在地球上观看网络回放。

运行结果驻留内存并按 LRU 逐出，因此宿主重启会丢失它们，面板从空白开始，模型更早见过的运行 id 也可能解析为 `supply_chain_unknown_run`。由于面板使用 Remote 而非投影，用户在 GUI 中运行的情景不属于会话历史，也无法从会话日志重建；只有工具调用返回的内容才会抵达模型与对话记录。这保持了“模型可见 ⟺ 已记录”规则的完整性——面板的运行对模型不可见——但也意味着 GUI 与智能体不会自动共享一次运行。

该提供者无法在 CI 或任何默认安装中运行，因为它需要一份真实的本地 ISOMORPH 检出以及一个装有其依赖的 Python 解释器。它的集成测试在未设置 `DSH_ISOMORPH_ROOT` 与 `DSH_ISOMORPH_PYTHON` 时自行跳过，因此引擎路径只在开发机上得到验证；提供者之上的一切都用桩提供者执行，可在任何环境运行。

启用该提供者是一次需要两个值的配置行为，而不是一个开关：overlay 必须清除 `disabled` 并提供两个路径。在此之前接缝会返回 `supply_chain_simulator_unavailable`，这是刻意的大声失败，而非静默的空操作。

## Testing

接缝的测试覆盖配置解析与边界、预设解析、`maxRuns` 处的保留与逐出、以手工计算序列核对的三个报告构建器、`supply-chain/run` 的先提交后发出顺序，以及面向面板的 Remote（含解析后的预设目录）。工具包的测试覆盖每个工具的参数、追加的 `Accepted range` 描述，以及未知运行、节点、物料与缺失提供者的错误映射。

提供者的测试在设置了 `DSH_ISOMORPH_ROOT` 与 `DSH_ISOMORPH_PYTHON` 时运行真实模拟器，否则自行跳过。其敏感性用例锁定桥接参数确实抵达了模型：基线达成 1.0 的满足率且无缺货，`capacityScale: 0.2` 把它压到 0.18 并产生 71 405 单位缺货，`safetyStockScale: 0.1` 则把线路峰值利用率推到运力之上。一个可复现性用例锁定同一种子精确重现、另一种子发生分叉。

客户端测试覆盖回放控制器对定时器的所有权——每天推进三帧、在最后一天停止而非循环、在末尾按下播放时从 0 重新开始、暂停时保持位置、销毁时释放定时器——以及各项纯派生：货物仅在出发与到达之间出现、按分数天平滑移动、当日到达落在目的地、未知设施被跳过、物料配色循环、多段路径插值，以及让货物位于设施之上、设施位于线路之上的绘制顺序。`ui-geo-earth` 的叠加层测试锁定具名叠加层从不扰动 Drawings 数据源。
