# @deepseek-ai/dsh-client-ui-supply-chain

[English](README.md) | 中文

供应链仿真器的浏览器侧：一个 `conversation.view` 标签页，用于配置情景、运行它、渲染三份报告，并在 3D 地球上逐日回放由此产生的网络。

## 注册内容

一个 `conversation.view` 条目（id 为 `supply-chain`，order 为 30），与既有的 Chat、Trajectory 和 Summary 标签页并列。情景控件涵盖预设以及用户最可能调整的数值设置；每个滑块以所选预设解析后的配置为初值，该配置由宿主通过 `catalog` Remote 提供，因此浏览器不持有第二份默认值副本。

## 数据通路

面板调用接缝的 Typert Remote——`simulate`、`run` 与 `catalog`——而不是读取会话投影。一次完成的运行是请求/响应数据，只要面板持有它就驻留在浏览器中；它不是会话历史。

## 回放的归属

回放状态——运行、连续位置以及是否正在播放——位于 [src/client/replayController.ts](src/client/replayController.ts)，在插件体内创建，并通过注入的 `hooks` 分区暴露给组件。用户切换到 Chat 时中栏标签页就会卸载，因此组件状态与 effect 定时器无法承载一次回放；而控制器会持续推进并持续重绘地球，后者始终显示在自己的栏中。播放在最后一天停止而不是循环，在末尾按下播放则从第 0 天重新开始。

`position` 与 `day` 是两个独立发布的事实：图表与天数计数读取整数天，而地球读取连续位置，从而让在途货物在日边界之间平滑插值。

## 地球叠加层

网络通过 `ctx.earthOverlays` 绘制到自己的具名 Cesium 图层中，该服务由 `@deepseek-ai/dsh-client-ui-geo-earth` 发布。智能体自己的 "Drawings" 图层是独立的数据源，本包从不触碰它。标记大小编码设施的层级角色，标记颜色编码它当天是否背负缺货，线路宽度编码其利用率，线路颜色标示饱和或正在发生的中断；在途货物以其物料的颜色叠加在最上层。面板内的图例与叠加层读取同一张角色与颜色表，因此两者不会彼此矛盾。

## Model Experience

None, as the panel registers no prompt, tool, or session event; it renders completed runs it reads over Typert Remotes, and `@deepseek-ai/dsh-tool-supply-chain` owns every model-visible projection of the same data.

#### KV Cache effect

No direct effect. A scenario run from this panel reaches a model request only when the agent separately calls a supply-chain tool, which owns the resulting prefix change.

## Known Limitations and Deferred Work

- **用户的运行对模型不可见**——面板的 Remote 是请求/响应式的，因此它运行的任何内容都不会进入会话日志或对话记录。用户无法就自己刚运行的情景向智能体提问，除非再通过工具运行一次。
- **宿主重启后面板为空**——它只渲染接缝仍保留在内存中的内容，并且不会在挂载时恢复此前的运行。
- **报告为原生渲染，而非来自上游图表**——三个视图是在此处由原始序列绘制的 SVG，并非上游模拟器的 Plotly 图表；上游地图提供的某种图表，只有本包画了才会存在。
- **面板只能触达部分配置**——滑块暴露常用设置；`SimulationConfig` 的其余字段只能通过工具触达。
- **线路几何按天重建**——覆盖式地面图元异步加载，因此线路仅在日边界重绘，而货物每帧移动；时间跨度非常短时，可能看到回放经过时线路仍在加载。
