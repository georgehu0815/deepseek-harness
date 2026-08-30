# Agent Note: Render drawn geo features with labels on the 3D Earth globe

Status: implemented

[English](2026-08-29-earth-drawn-feature-rendering.md) | 中文

## Problem

`geoCommand` 会话投影累积一个 `features` 数组——agent 的 `draw_*`/`move`/`set-props`/`delete` 工具产生的绘制点、折线与多边形，移动与删除已折叠进一个最终的、按绘制顺序排列的集合。3D 地球面板能从该投影飞行相机并切换底图，却忽略了 `features`，因此 agent 绘制的一切都不显示在地球上。

`features` 的形态不同于其他地理输入。`command` 字段是桥接恰好应用一次的一次性指令，受单调 `seq` 门控，使重渲染与回放收敛到最后被命令的视图，而不重复触发中间的相机移动。`features` 是整体累积状态：任一时刻正确的地球是当前的完整集合，而一次变化未必以一次性守卫会认可的方式推进 `seq`。通过同一条 seq/一次性路径应用它会丢弃或重复应用绘制。

## Decision

`earthController` 新增 `renderFeatures(features)`，对一个名为“Drawings”的专用 Cesium `CustomDataSource` 做整体重建。每次调用把该集合记为控制器状态；当查看器已附着时，清空数据源实体并按每个要素重建一个 `Entity`——点/折线/多边形图形，并在要素带非空名称时附加一个锚定在点位置或线/环首个顶点的文本标签。记住的集合在 `attach` 时（在底图之后）重新应用，因此后挂载的查看器能仅凭投影重建绘制。`detach` 丢弃数据源引用，使新查看器获得新的数据源；数据源仅被添加进查看器一次，并防止在重渲染间重复添加。

`GeoCommandBridge` 通过**第二个** `useEffect`（以 `state?.features` 为键）驱动它，调用 `earthController.renderFeatures(state.features ?? [])`。这刻意独立于受 seq 门控的命令效果：命令效果为相机/底图保留其“仅当 `seq` 推进时应用”的约定，而要素协调在累积集合变化时运行，独立于 `seq`、也独立于一次性命令分支。未定义的投影协调空集合而非崩溃。

标签设置 `disableDepthTestDistance: Number.POSITIVE_INFINITY`，使名称在其锚点旋转到地球背面或落到地平线以下时永不被地球遮挡——否则 Cesium 会用椭球对标签文本做深度测试，隐藏锚点背向的标签，对全地球注记层而言表现为名称闪烁、消失。

## Full reconcile vs. incremental diff

每次要素集变化重建所有实体，而非将旧集合与新集合做差分并只改动增量。重建为每次变化 O(要素数)，而这里的注记数量极小——一小撮 agent 绘制的标记，而非舰队。差分会引入一个按 id 键控的协调器（增/改/删、逐图形属性修补），其复杂度在此规模不值当且易出微妙错误。该权衡记录在包 README 的 Known Limitations；实体级差分被推迟，直到要素规模让重建成本变得可见。

## Alternatives considered

- **把 features 折入 seq/一次性命令效果** —— 拒绝：`features` 是累积的整体状态，而非一次性命令。`seq` 守卫的存在是为避免重复触发相机移动；将整体协调置于其后会跳过共享同一 `seq` 的合法要素变化，而将其穿过 `command.kind` 分支会耦合两种无关的更新节奏。
- **增量实体差分** —— 暂拒绝：在注记规模下复杂度不值当（见上）。
- **每要素或每几何类型一个数据源** —— 拒绝：单一“Drawings”数据源使协调与拆除都是一次清空并重建，且契合绘制工具呈现的单图层模型。
- **省略 `disableDepthTestDistance`** —— 拒绝：地球深度测试会隐藏锚点背向相机的标签，这对全地球注记层是错误的。

## Consequences

地球现在显示 agent 绘制的一切，带可选名称，且新挂载或回放的查看器能从投影重建完整的“Drawings”图层。代价是每次要素变化的整体重建，以及上文所述被推迟的增量差分工作。桥接的底图分支现被收窄为 `command.kind === 'basemap'`（其他命令种类——领域切换、绘制/移动/编辑/删除族——由投影折叠进 `enabledDomains`/`features`，而非在此作为一次性地球命令应用），关闭了不断增长的命令联合类型打开的一个潜在类型漏洞。行为由包内规格固定：控制器协调（每种几何类型、名称有无、仅添加一次、无查看器/已销毁查看器、带记住要素的 attach）与桥接独立的要素效果，均达到 100% 单文件覆盖率。
