# Agent Note: 将 Terra 的地理体验以插件形式移植进 DeepSeek Harness

Status: implemented

[English](2026-08-20-terra-geo-plugin-port.md) | 中文

## Problem

Terra 是一个独立的 Cesium/Three.js 产品：一个 3D 地球视图、一个驱动地球的智能体，以及一个 Fastify BFF（`:4176`），后者从 SQLite 提供目录/领域/地理编码数据。把它的体验带入 DeepSeek Harness，意味着 harness 智能体应在 Web GUI 中展示一个可交互的地球，并用任意 harness 模型来操控它——飞行相机、切换影像——且无需启动 Terra 的服务器，也不把 harness 耦合到 Terra 的进程上。Harness 以插件方式在能力接缝之上组合一切，并从会话日志重建每一个模型可见的输入；一个从浏览器直连外部 HTTP 服务、或用临时 socket 推送相机命令的粗糙移植，会同时违反这两条。

## Decision

本次移植是一组跨两个平面的 harness 插件，自包含（不需要 Terra 后端）且重放正确。

**地理能力接缝（`ctx.geo`），宿主平面。** `@deepseek-ai/dsh-geo` 是服务定义加一个内置提供者：`geocode(query, limit, signal)` 与静态底图预设（`osm`、`carto-dark`、`carto-light`、`esri-satellite`）。默认提供者（`public-nominatim`）调用公开的 OpenStreetMap Nominatim，带超时截止、响应字节上限与手动重定向；`registerProvider` 允许后续以 Terra 支撑的提供者替换它，而无需触碰工具或客户端。提供者配置（`nominatimBaseUrl`、`userAgent`、`geocodeTimeoutMs`）是 `Config`，而非常量。

**读工具。** `@deepseek-ai/dsh-tool-geo-query` 在 `ctx.geo` 之上暴露 `geo_geocode`（地名→坐标 + bbox）与 `geo_list_basemaps`。两者均只读、并发安全，且不拥有任何 I/O。

**通过会话投影完成智能体→地球命令回路。** 受支持的按会话“服务端→客户端”推送是一个会话事件加一个投影，而非专用 socket。`@deepseek-ai/dsh-geo-command` 声明 `geo/command` 会话事件（相机或底图）与 `geoCommand` 投影——一次后者胜出的折叠，携带最新命令与按会话的 `seq`。`@deepseek-ai/dsh-tool-geo-control` 暴露 `control_camera` 与 `set_basemap`，它们把 `geo/command` 追加到调用方智能体的会话（非智能体调用方被拒绝）。网关自动铸造一个 `session/projection` 帧；客户端通过标准的 `useProjection` 钩子读取它。投影即期望视图状态，因此重放会收敛到最后被命令的视图，而不重放中间的相机移动。

**地球及其桥接，浏览器平面。** `@deepseek-ai/dsh-client-ui-geo-earth` 把 CesiumJS 查看器挂载在外壳一等的 `earth` 栅格列中——`ui-layout` 的第四条轨道（`sidebar | center | details | earth`），由侧栏动作经 `ctx.layout.toggleEarth()` 打开，并从列头经 `ctx.layout.closeEarth()` 关闭。earth 列是 `AppFrame` 与其他子项一同声明的一个 `single`、`root` 作用域槽位；其宽度由让渡链（`columns.ts`）求解，随视口收窄时该链在 details 之前先让渡 earth 轨道，并在 details 之前自动关闭它。引擎资源从 `/cesium` 提供；控件样式表在运行期通过一个被提供的 `<link>` 注入，因为客户端包的 CSS 流水线只解析相对样式表。列内的可见性切换会隐藏地球，同时保持 Cesium 引擎挂载；一个不可见的、会话作用域的 `GeoCommandBridge`（注册进 `conversation.session.header.utilities`）读取 `useProjection('geoCommand')` 并驱动共享的 `earthController`，仅在 `seq` 前进时才应用命令。当没有查看器挂载时，控制器记住期望的底图，并在挂载时应用。

地理宿主行在 `packages/bundle/base/cordis.patch.yml` 中于宿主平面加载，且在 web-app 补丁中未被禁用，因此它们注册进全局工具层，默认到达每个 Web 会话的智能体。

## Alternatives considered

**在 Phase 1 就代理到 Terra 的实时 Fastify BFF。** 忠实于 Terra 的目录/领域/资产，但需要运行 Terra 的服务器及其导入的 SQLite 数据——对一个演示而言是沉重的外部依赖。该接缝把“Terra 支撑的提供者”保留为可直接替换项，因此以后仍可用而无需重做工具或客户端。

**用专用 WebSocket 升级路由推送相机命令。** 确实是短暂的，但需要一个专门的客户端接收端、复用受信请求检查，且它不是重放正确的——一个重连或重放的客户端会错过最后被命令的视图。投影既是最低影响面的通道，又具备正确的重放语义。

**用一个框架级 `shell.overlay` 面板代替栅格列。** 早期步骤曾把地球挂载在右侧停靠的 `shell.overlay` 层中，从而不改动任何 `ui-layout`。它是浮在会话之上的漂浮层，而非所请求的常驻右列，且无法相对其他列进行缩放。已交付的 `earth` 栅格轨道让地球成为一等的、可缩放的列，并在 details 之前先让渡，代价是编辑共享框架及其让渡求解器——这才是最初"侧栏 + 会话 + 右侧 3D 视图"请求的正确实现。其余地理领域图层规格见 [Agent Note: Geo domain layers for the Terra port](../../proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。

## Consequences

Harness 智能体可用任意模型对某地地理编码、飞行相机并切换底图影像，且地球可从会话日志重建。六个宿主行（接缝、投影、四个工具）需要重启 `dsh web` 才能加载，因为启动名册在启动时固定；客户端包从磁盘按新鲜度提供，故客户端改动只需重建并刷新。

Cesium 打进 `lib/client.js` 约 10.9 MB；对演示可接受，但若地球广泛发布，则是插件自有外部加载的候选。客户端包沿用 `@deepseek-ai/dsh-client-ui-anatomy-3d` 的命令式 WebGL 画布模式——一个模块级控制器经由 `useSyncExternalStore` 观察——它处于严格客户端 store/钩子纪律之外；一个广泛发布的地球应重新审视该状态是否应放入声明式 store。`ui-anatomy-3d` 仍是 `verify-package-invariants` 上不合规的先例；四个地理包各自拥有合规的 `./invariant`，附带包专属的空安装器原因。

`earth` 栅格单元（`.earthCol`）设为 `position: relative`，使得以 `position: absolute; inset: 0` 填充其宿主的地球占据者被限制在该列内，而非逃逸到 `position: relative` 的框架并浮在会话之上。任何绝对定位的 `earth` 槽位占据者都依赖该单元作为其包含块。

## Testing

`@deepseek-ai/dsh-tool-geo-control` 带一个真实 Loader 组合测试：一个启动的 `cordis.yml` 挂载接缝、投影与两个工具包，然后断言四个工具被提供，且执行它们返回模型可见的结果并追加正确的 `geo/command` 事件（geocode 使用注册在 `ctx.geo` 上的桩提供者，故测试无需网络）。`@deepseek-ai/dsh-geo-command` 带一个投影提供者测试，经由真实 apiproxy 读取历史尾页——即客户端桥接消费的同一条线路——断言首个事件前的零-seq 空命令、后者胜出的 `seq` 前进、无插件时键的缺失，以及 fiber 卸载时键的移除。
