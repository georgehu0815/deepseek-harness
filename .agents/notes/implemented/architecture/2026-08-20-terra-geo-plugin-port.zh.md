# Agent Note: 将 Terra 的地理体验以插件形式移植进 DeepSeek Harness

Status: implemented

[English](2026-08-20-terra-geo-plugin-port.md) | 中文

## Problem

Terra 是一个独立的 Cesium/Three.js 产品：一个 3D 地球视图、一个驱动地球的智能体，以及一个 Fastify BFF（`:4176`），后者从 SQLite 提供目录/领域/地理编码数据。把它的体验带入 DeepSeek Harness，意味着 harness 智能体应在 Web GUI 中展示一个可交互的地球，并用任意 harness 模型来操控它——飞行相机、切换影像——且无需启动 Terra 的服务器，也不把 harness 耦合到 Terra 的进程上。Harness 以插件方式在能力接缝之上组合一切，并从会话日志重建每一个模型可见的输入；一个从浏览器直连外部 HTTP 服务、或用临时 socket 推送相机命令的粗糙移植，会同时违反这两条。

## Decision

本次移植是一组跨两个平面的 harness 插件，自包含（不需要 Terra 后端）且重放正确。

**地理能力接缝（`ctx.geo`），宿主平面。** `@deepseek-ai/dsh-geo` 是服务定义加一个内置提供者：`geocode(query, limit, signal)` 与静态底图预设（`osm`、`carto-dark`、`carto-light`、`esri-satellite`）。默认提供者（`public-nominatim`）调用公开的 OpenStreetMap Nominatim，带超时截止、响应字节上限与手动重定向；`registerProvider` 允许后续以 Terra 支撑的提供者替换它，而无需触碰工具或客户端。提供者配置（`nominatimBaseUrl`、`userAgent`、`geocodeTimeoutMs`）是 `Config`，而非常量。

**读工具。** `@deepseek-ai/dsh-tool-geo-query` 在 `ctx.geo` 之上暴露六个只读、并发安全、不拥有任何 I/O 的工具：`geo_geocode`（地名→坐标 + bbox）、`geo_list_basemaps`，以及四个领域数据工具——`geo_catalog_search`（数据集目录）、`geo_domain_list`（图层可用性）、`geo_domain_query`（在某个细节级别下 bbox 内的要素）与 `geo_feature_get`（按 id 取单个要素）。这四个领域工具调用 `ctx.geo` 的可选方法；在内置的仅地理编码提供者上它们抛出 `geo_unsupported`（`active geo provider '<id>' does not support <method>; select a domain-data provider`）。`GeoDomainFeature.geometry` 与 `.properties` 是 `Record<string, GeoJsonValue>`（GeoJSON 原样透传；无几何的要素映射为 `{}`）。

**Terra 领域提供者（休眠）。** `@deepseek-ai/dsh-host-geo-bff` 是一个服务提供者，经 HTTP 代理 Terra 的 Fastify BFF（目录/领域/要素/资产），实现 `ctx.geo` 的可选领域方法。它不依赖 SQLite——它是一个轻量 HTTP 客户端，带一个防 DNS 重绑定的 SSRF 目标策略（`validateTarget`/`validateConnectedAddress`）、一个可注入的 `fetchImpl`/`resolver` 供测试使用、一个响应字节上限与一个请求截止。`baseUrl`/`timeoutMs`/`allowPrivateSources`/`maxResponseBytes` 是 `Config`。它在 `packages/bundle/base/cordis.patch.yml` 中以 `disabled: true` 发布：启用它会让 Terra BFF 成为活动的地理提供者，因此在覆盖层清除 `disabled` 并把 `baseUrl` 指向一个运行中的 Terra 源之前，它保持休眠。故默认 Web 会话保持仅地理编码。

**视图上下文。** `@deepseek-ai/dsh-geo-viewcontext` 把实时的地球相机视图——派生的边界框与细节级别（`deriveViewBBox`，在 6 371 km 球体上以 60° FOV 计算；整个地球产出 `[-180,-90,180,90]`）——作为一个步骤前瀑布注入到下一个模型步骤，因此领域查询可以使用屏幕上的边界。它在 base 包中以活动状态加载。

**通过会话投影完成智能体→地球命令回路。** 受支持的按会话“服务端→客户端”推送是一个会话事件加一个投影，而非专用 socket。`@deepseek-ai/dsh-geo-command` 声明 `geo/command` 会话事件（相机或底图）与 `geoCommand` 投影——一次后者胜出的折叠，携带最新命令与按会话的 `seq`。`@deepseek-ai/dsh-tool-geo-control` 暴露 `control_camera` 与 `set_basemap`，它们把 `geo/command` 追加到调用方智能体的会话（非智能体调用方被拒绝）。网关自动铸造一个 `session/projection` 帧；客户端通过标准的 `useProjection` 钩子读取它。投影即期望视图状态，因此重放会收敛到最后被命令的视图，而不重放中间的相机移动。

**地球及其桥接，浏览器平面。** `@deepseek-ai/dsh-client-ui-geo-earth` 把 CesiumJS 查看器挂载在外壳一等的 `earth` 栅格列中——`ui-layout` 的第四条轨道（`sidebar | center | details | earth`），由侧栏动作经 `ctx.layout.toggleEarth()` 打开，并从列头经 `ctx.layout.closeEarth()` 关闭。earth 列是 `AppFrame` 与其他子项一同声明的一个 `single`、`root` 作用域槽位；其宽度由让渡链（`columns.ts`）求解，随视口收窄时该链在 details 之前先让渡 earth 轨道，并在 details 之前自动关闭它。引擎资源从 `/cesium` 提供；控件样式表在运行期通过一个被提供的 `<link>` 注入，因为客户端包的 CSS 流水线只解析相对样式表。列内的可见性切换会隐藏地球，同时保持 Cesium 引擎挂载；一个不可见的、会话作用域的 `GeoCommandBridge`（注册进 `conversation.session.header.utilities`）读取 `useProjection('geoCommand')` 并驱动共享的 `earthController`，仅在 `seq` 前进时才应用命令。当没有查看器挂载时，控制器记住期望的底图，并在挂载时应用。

地理宿主行在 `packages/bundle/base/cordis.patch.yml` 中于宿主平面加载，且在 web-app 补丁中未被禁用，因此它们注册进全局工具层，默认到达每个 Web 会话的智能体。

## Alternatives considered

**在 Phase 1 就代理到 Terra 的实时 Fastify BFF。** 忠实于 Terra 的目录/领域/资产，但需要运行 Terra 的服务器及其导入的 SQLite 数据——对一个演示而言是沉重的外部依赖。该接缝把“Terra 支撑的提供者”保留为可直接替换项：`@deepseek-ai/dsh-host-geo-bff` 现已实现它，并以休眠方式发布，因此默认配置与 Terra 零耦合，而该能力只需一个覆盖层即可启用。

**用专用 WebSocket 升级路由推送相机命令。** 确实是短暂的，但需要一个专门的客户端接收端、复用受信请求检查，且它不是重放正确的——一个重连或重放的客户端会错过最后被命令的视图。投影既是最低影响面的通道，又具备正确的重放语义。

**用一个框架级 `shell.overlay` 面板代替栅格列。** 早期步骤曾把地球挂载在右侧停靠的 `shell.overlay` 层中，从而不改动任何 `ui-layout`。它是浮在会话之上的漂浮层，而非所请求的常驻右列，且无法相对其他列进行缩放。已交付的 `earth` 栅格轨道让地球成为一等的、可缩放的列，并在 details 之前先让渡，代价是编辑共享框架及其让渡求解器——这才是最初"侧栏 + 会话 + 右侧 3D 视图"请求的正确实现。本说明的读工具与 Terra 提供者所实现的地理领域数据路径的规格，见 [Agent Note: Geo domain layers for the Terra port](../../proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。

## Consequences

Harness 智能体可用任意模型对某地地理编码、飞行相机并切换底图影像，且地球可从会话日志重建。base 包的地理宿主行（接缝、投影、查询与控制工具包、活动的视图上下文插件，以及休眠的 Terra 提供者）需要重启 `dsh web` 才能加载，因为启动名册在启动时固定；客户端包从磁盘按新鲜度提供，故客户端改动只需重建并刷新。

Cesium 打进 `lib/client.js` 约 10.9 MB；对演示可接受，但若地球广泛发布，则是插件自有外部加载的候选。客户端包沿用 `@deepseek-ai/dsh-client-ui-anatomy-3d` 的命令式 WebGL 画布模式——一个模块级控制器经由 `useSyncExternalStore` 观察——它处于严格客户端 store/钩子纪律之外；一个广泛发布的地球应重新审视该状态是否应放入声明式 store。`ui-anatomy-3d` 仍是 `verify-package-invariants` 上不合规的先例；四个地理包各自拥有合规的 `./invariant`，附带包专属的空安装器原因。

`earth` 栅格单元（`.earthCol`）设为 `position: relative`，使得以 `position: absolute; inset: 0` 填充其宿主的地球占据者被限制在该列内，而非逃逸到 `position: relative` 的框架并浮在会话之上。任何绝对定位的 `earth` 槽位占据者都依赖该单元作为其包含块。

## Testing

`@deepseek-ai/dsh-tool-geo-control` 带一个真实 Loader 组合测试：一个启动的 `cordis.yml` 挂载接缝、投影与两个工具包，然后断言四个工具被提供，且执行它们返回模型可见的结果并追加正确的 `geo/command` 事件（geocode 使用注册在 `ctx.geo` 上的桩提供者，故测试无需网络）。`@deepseek-ai/dsh-geo-command` 带一个投影提供者测试，经由真实 apiproxy 读取历史尾页——即客户端桥接消费的同一条线路——断言首个事件前的零-seq 空命令、后者胜出的 `seq` 前进、无插件时键的缺失，以及 fiber 卸载时键的移除。

`@deepseek-ai/dsh-tool-geo-query` 的 Loader 组合测试在 `ctx.geo` 上注册一个桩领域提供者并驱动这四个领域工具，覆盖未知领域的拒绝（提供者从不被调用）与仅地理编码提供者的 `does not support` 路径。`@deepseek-ai/dsh-host-geo-bff` 以注入的 `fetchImpl`/`resolver` 做单元测试（无网络）：SSRF 目标策略、到 `ctx.geo` 领域结果的 HTTP 代理映射，以及插件注册，达到按文件 100% 覆盖。`@deepseek-ai/dsh-geo-viewcontext` 单元测试 `deriveViewBBox` 与步骤前瀑布。

acp-agent 示例中的无密钥 `geo-domain` 快照把真实读工具与一个确定性的仓内 `ctx.geo` 桩提供者（`examples/acp-agent/geo-fixture-provider.mjs`，无网络）组合，并钉住模型可见面：六个地理工具 schema、系统提示，以及一个两次工具调用的转录（先 `geo_domain_list` 再 `geo_domain_query`），其工具结果反映桩数据。它是手写的（而非实况录制），因为固定的提供者让该轮次确定；`examples/acp-agent/geo.cordis.snapshot.yml` 是其重放对应物，仅把模型适配器替换为 `dsh-llm-replay`。
