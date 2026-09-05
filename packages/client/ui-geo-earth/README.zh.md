# @deepseek-ai/dsh-client-ui-geo-earth

[English](README.md) | 中文

交互式 3D 地球插件：侧栏入口打开外壳共享 `visual.workspace.view` slot 中的 `earth` 条目。第四条布局轨道为 `sidebar | center | details | visual`，其他独立插件可以贡献相邻标签。按钮调用 `ctx.layout.toggleVisual('earth')`，地球列头通过 `ctx.layout.closeVisual()` 关闭栏位。地球仍是可缩放布局列，而非嵌入应用。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

`sidebar.footer.action` 贡献打开 Earth 标签；`visual.workspace.view` 条目渲染现有地球列头，保留最大化、全屏和关闭控制。会话作用域的 `GeoCommandBridge` 和 `GeoViewReporter` 继续位于 `conversation.session.header.utilities`，Summary 视图和 `earthOverlays` 服务保留现有集成。地球使用可切换栅格底图（默认 OpenStreetMap）、椭球地形，并禁用 Cesium 部件。最大化保留引擎；关闭栏位或选择另一可视化标签会卸载引擎。

CesiumJS 引擎在运行时从 `/cesium` 加载 Workers、Assets、Widgets 与 ThirdParty 文件。这些静态文件是 Cesium 的 `Build/Cesium/` 树，被复制到 `apps/web/public/cesium` 并由 web 外壳提供，方式与 [ui-anatomy-3d](../ui-anatomy-3d/README.md) 提供其 `/models` glTF 资源完全相同。`window.CESIUM_BASE_URL` 在引擎读取它之前被设为 `/cesium`。没有这些文件时，面板会显示一条内联的“Engine assets may be missing from /cesium”消息，而不是抛出异常。

`/client` 导出仅是插件主体（`apply`/`inject`）；启动器、侧边栏按钮与 earth 列组件以及地球面板都保留在包内部，隐藏在槽位注册之后。

## Model Experience

### 浏览器地球（无直接的模型面）

#### What the model sees

没有任何内容。本包渲染一个仅浏览器的 3D 地球，以及一个读取 `geoCommand` 会话投影以驱动它的隐形桥接——飞行相机、切换底图，并把累积的绘制要素（点、折线与多边形，各带可选文本标签）协调进一个专用的“Drawings”图层。此处没有任何东西进入模型请求、工具模式或会话日志。agent 通过独立的 `@deepseek-ai/dsh-tool-geo-control` 与 `@deepseek-ai/dsh-tool-geo-query` 工具控制地球，其模式与结果在那里有文档说明。

#### Token effect

没有；本包既不组装也不发送提供者请求。

#### KV Cache effect

没有；本包既不组装也不发送提供者请求。

## Known Limitations and Deferred Work

- **仅相机、底图与绘制要素** —— 桥接应用 `control_camera`/`set_basemap` 命令，并协调累积的绘制要素（带可选标签的点/线/多边形）；`toggle_domain` 与其他领域图层控制被推迟到后续阶段。
- **整体重建绘制，而非增量差分** —— 每次要素集变化都会清空“Drawings”数据源并从投影的 `features` 列表重建所有实体。对于注记级别的数量这是最简单且正确的做法；实体级差分被推迟，直到要素规模值得为止。
- **除底图外没有其他图层** —— 3D 城市（3D Tiles）、点云（COPC/LAZ）、COG 影像、地理数据边界与 FreeGeoDB 领域被推迟；本阶段挂载带有可切换影像预设的基础地球。
- **每页一个地球** —— Earth 是共享可视化工作区中的一个条目，仅渲染选中的可视化标签。不支持多个地球。
- **引擎资源由外壳提供，而非打包** —— Cesium 的 `Build/Cesium/` 树被复制到 `apps/web/public/cesium`；一个自包含、插件拥有的资源路由被推迟。
