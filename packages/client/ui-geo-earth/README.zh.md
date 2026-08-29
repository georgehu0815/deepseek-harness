# @deepseek-ai/dsh-client-ui-geo-earth

[English](README.md) | 中文

交互式 3D 地球插件：侧边栏底部的“Earth 3D”动作会在外壳一等的 `earth` 网格列——第四条 `ui-layout` 轨道（`sidebar | center | details | earth`）——中打开一个 CesiumJS 地球。按钮通过 `ctx.layout.toggleEarth()` 切换该列，列头通过 `ctx.layout.closeEarth()` 关闭它，因此地球是一个真实的、可缩放的布局列，而非漂浮浮层。契约：[槽位系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

该插件注册进三个槽位且不拥有任何共享 store。`sidebar.footer.action` 获得一个“Earth 3D”按钮（在“Human Body 3D”旁边），其注入的 `toggleEarth` 回调驱动布局；`earth` 网格列座位渲染地球以及一个带列内可见性切换与关闭按钮的列头（其注入的 `closeEarth` 回调）。`conversation.session.header.utilities` 中一个会话作用域的贡献是隐形的 `GeoCommandBridge`。地球使用可切换的栅格底图层（默认 OpenStreetMap）、椭球地形，并禁用所有 Cesium 部件——与 Terra 的 `CesiumEarth` 相同的配置。一个页面级的可见性可观察对象会隐藏地球，同时保持 Cesium 引擎挂载，使得切回时即时呈现。

CesiumJS 引擎在运行时从 `/cesium` 加载 Workers、Assets、Widgets 与 ThirdParty 文件。这些静态文件是 Cesium 的 `Build/Cesium/` 树，被复制到 `apps/web/public/cesium` 并由 web 外壳提供，方式与 [ui-anatomy-3d](../ui-anatomy-3d/README.md) 提供其 `/models` glTF 资源完全相同。`window.CESIUM_BASE_URL` 在引擎读取它之前被设为 `/cesium`。没有这些文件时，面板会显示一条内联的“Engine assets may be missing from /cesium”消息，而不是抛出异常。

`/client` 导出仅是插件主体（`apply`/`inject`）；启动器、侧边栏按钮与 earth 列组件以及地球面板都保留在包内部，隐藏在槽位注册之后。

## Model Experience

### 浏览器地球（无直接的模型面）

#### What the model sees

没有任何内容。本包渲染一个仅浏览器的 3D 地球，以及一个读取 `geoCommand` 会话投影以驱动它的隐形桥接；此处没有任何东西进入模型请求、工具模式或会话日志。agent 通过独立的 `@deepseek-ai/dsh-tool-geo-control` 与 `@deepseek-ai/dsh-tool-geo-query` 工具控制地球，其模式与结果在那里有文档说明。

#### Token effect

没有；本包既不组装也不发送提供者请求。

#### KV Cache effect

没有；本包既不组装也不发送提供者请求。

## Known Limitations and Deferred Work

- **仅相机与底图** —— 桥接应用 `control_camera`/`set_basemap` 命令；`toggle_domain`/`draw_*` 控制被推迟到后续阶段。
- **除底图外没有其他图层** —— 3D 城市（3D Tiles）、点云（COPC/LAZ）、COG 影像、地理数据边界与 FreeGeoDB 领域被推迟；本阶段挂载带有可切换影像预设的基础地球。
- **每页一个地球** —— earth 列是一个 `single`、`root` 作用域座位，只有一个占据者；不支持多查看器。
- **引擎资源由外壳提供，而非打包** —— Cesium 的 `Build/Cesium/` 树被复制到 `apps/web/public/cesium`；一个自包含、插件拥有的资源路由被推迟。
