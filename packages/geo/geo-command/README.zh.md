# @deepseek-ai/dsh-geo-command

[English](README.md) | 中文

agent→Earth 命令通道：`geo/command` 会话事件与 `geoCommand` 会话投影，用于将最新期望的地球视图——以及累积的领域图层与已绘制要素——传递给浏览器。属于 Terra geo 移植（第 3 阶段）。

## 功能说明

声明 `geo/command` 会话事件（一个相机、底图、领域开关或要素绘制/移动/重命名/删除/撤销命令），并注册 `geoCommand` 投影。该折叠对 `command` 采用末位胜出，对 `enabledDomains` 与 `features` 采用累积。`@deepseek-ai/dsh-tool-geo-control` 追加这些事件；`@deepseek-ai/dsh-client-ui-geo-earth` 中的客户端桥接通过 `useProjection('geoCommand')` 读取该投影并驱动地球，在序列号推进时应用最新命令，并从累积状态重建领域可见性与"Drawings"图层。

## 会话投影

`geoCommand` 的初始值为 `{ seq: 0, command: null, enabledDomains: [], features: [] }`。每个 `geo/command` 事件递增 `seq` 并替换 `command`；任何其他事件返回相同的状态引用（没有虚假帧）。`domain-toggle` 从 `enabledDomains` 中添加或移除一个图层 id（首次启用顺序）；`draw-feature` 追加一个要素；`move-feature` 按 `[lon, lat]` 增量平移其几何；`set-feature-props` 重命名它；`delete-features` 按 id 删除；`undo-draw` 丢弃最近的一个。由于该状态携带完整的期望视图，重放会收敛到最后被命令的相机与底图，并重建确切的启用图层与已绘制要素。

## 导出形态

默认导出注册投影的插件。`./types` 是 `GeoCameraCommand`、`GeoBaseMapCommand`、领域与绘制命令类型、`GeoCommand`、`GeoDrawnFeature` 与 `GeoCommandState` 的唯一归处，并声明 `SessionEventMap` 与 `SessionProjectionMap` 的成员。`./client` 为浏览器侧重新导出这些类型。

## Model Experience

### 命令通道（无直接的模型面）

#### What the model sees

没有任何直接内容。`geo/command` 事件与 `geoCommand` 投影是 UI 和重放状态，从不是模型消息。模型通过 `@deepseek-ai/dsh-tool-geo-control` 行动，其结果在那里有文档说明。

#### Token effect

本包不产生任何影响。

#### KV Cache effect

本包不产生任何影响；命令事件不属于模型请求的一部分。

## Known Limitations and Deferred Work

- **渲染被推迟** —— 该投影携带启用领域与已绘制要素，但在地球上绘制它们的 Cesium 控制器将在后续客户端阶段落地；参见[提议说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **相机与底图末位胜出** —— `command` 槽位仅保留最新的命令；重连或重放的客户端会收敛到最终的相机与底图，不会观察到中间的。领域开关与已绘制要素则会累积。
