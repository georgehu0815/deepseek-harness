# Agent Note: 为 Terra 移植提供地理领域图层

Status: proposed

[English](2026-08-20-design-terra-geo-plugin-dsh.md) | 中文

Terra 移植的 Phase 1–2 已交付——地理接缝、查询/控制工具、`geoCommand` 投影，以及带智能体→地球命令回路的 CesiumJS 地球——且一等的地球栅格列已交付，把地球从覆盖层提升为第四条 `ui-layout` 轨道。两者均记录于 [Agent Note: Port Terra's geo experience into DeepSeek Harness as plugins](../../implemented/architecture/2026-08-20-terra-geo-plugin-port.md)。本提案覆盖剩余的地理领域图层工作。

## Problem

已交付的地理接缝只提供地理编码与静态底图预设；Terra 更丰富的价值在其领域数据（目录搜索、机场/建筑/激光雷达图层、供应链模拟），由一个 Fastify BFF 在 SQLite 之上提供。它被延后，因为它是庞大的后端面，不应仓促推进。

## Proposal

**地理领域图层。** 让接缝与工具超出地理编码，保持自包含提供者为默认、Terra 支撑的提供者为可直接替换项：

- 宿主：一个 `@deepseek-ai/dsh-host-geo-bff` 提供者，或代理 Terra 的 Fastify `:4176`（`/api/catalog/search`、`/api/domains/{layer}?bbox=&lod=`、`/api/assets`、`/api/domains/{layer}/feature/{id}`），或把热路由重述为 `dsh-api-gateway` 上的 Typert Remote 方法；以及一个 `@deepseek-ai/dsh-geo-viewcontext` 请求上下文插件，把实时相机/视图-bbox 与邻近上下文注入每个请求。
- 工具：为 `tool-geo-query` 扩展 `geo_catalog_search`、`geo_domain_query`、`geo_feature_get`；为 `tool-geo-control` 扩展 `toggle_domain`、`draw_point`/`draw_polyline`/`draw_polygon`、`move_feature`，均追加由 `geoCommand` 投影折叠的 `geo/command` 变体。
- 客户端：一个 `@deepseek-ai/dsh-client-ui-geo-layers` 图层/源/领域控制面板，坐落于地球列内，以及对领域影像/矢量图层的控制器支持。
- 可选：把 `plugin-geo/skills/*/SKILL.md` 剧本移植进 `skill` 注册表。

## Acceptance criteria

- 智能体经由 `geoCommand` 投影至少切换一个领域图层并绘制一个出现在地球上的要素，由一个真实组合测试与一段无密钥快照验证。
- 默认地理提供者保持自包含；Terra 支撑的提供者可经配置选择而无需改动工具或客户端。

## Alternatives considered

**在代理之前先原生重写 Terra 的领域路由。** 忠实且进程轻，但一开始就是庞大的后端迁移；先代理 `:4176` 以验证工具与客户端，热路由随后迁移到 Typert Remote，而无需重做二者。

## Risks

- **Cesium 资源与包大小。** 引擎已以约 10.9 MB 打进 `client.js`；领域影像/worker 资源与 `CESIUM_BASE_URL` 处理可能推向插件自有的外部加载。需要一次构建集成探针。
- **BFF 进程耦合。** 代理 Terra 的 Fastify `:4176` 会重新引入第二个 Node 进程；确认这在短期是否可接受，或热路由是否应从一开始就原生化。SSRF 防护与 COG/领域 worker 留在所选路径之后。
- **快照与 GIF 覆盖。** 每个模型或 GUI 可见的改动都需要无密钥快照覆盖，且对 GUI 需要一段从真实服务器录制的 GIF，遵循仓库政策。
