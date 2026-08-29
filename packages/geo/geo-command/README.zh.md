# @deepseek-ai/dsh-geo-command

[English](README.md) | 中文

agent→Earth 命令通道：`geo/command` 会话事件与 `geoCommand` 会话投影，用于将最新期望的地球视图传递给浏览器。属于 Terra geo 移植（第 2 阶段）。

## 功能说明

声明 `geo/command` 会话事件（一个相机或底图命令），并注册 `geoCommand` 投影——一种末位胜出的折叠，保存最近的命令加上一个每会话的序列号。`@deepseek-ai/dsh-tool-geo-control` 追加这些事件；`@deepseek-ai/dsh-client-ui-geo-earth` 中的客户端桥接通过 `useProjection('geoCommand')` 读取该投影并驱动地球，仅在序列号推进时才应用某个命令。

## 会话投影

`geoCommand` 的初始值为 `{ seq: 0, command: null }`。每个 `geo/command` 事件递增 `seq` 并替换 `command`；任何其他事件返回相同的状态引用（没有虚假帧）。由于该投影是期望视图状态，重放会收敛到最后被命令的视图，而不会重新触发中间的相机移动。

## 导出形态

默认导出注册投影的插件。`./types` 是 `GeoCameraCommand`、`GeoBaseMapCommand`、`GeoCommand` 与 `GeoCommandState` 的唯一归处，并声明 `SessionEventMap` 与 `SessionProjectionMap` 的成员。`./client` 为浏览器侧重新导出这些类型。

## Model Experience

### 命令通道（无直接的模型面）

#### What the model sees

没有任何直接内容。`geo/command` 事件与 `geoCommand` 投影是 UI 和重放状态，从不是模型消息。模型通过 `@deepseek-ai/dsh-tool-geo-control` 行动，其结果在那里有文档说明。

#### Token effect

本包不产生任何影响。

#### KV Cache effect

本包不产生任何影响；命令事件不属于模型请求的一部分。

## Known Limitations and Deferred Work

- **仅相机与底图命令** —— 领域切换与绘制命令随其工具一同被推迟；参见[提议说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **末位胜出，而非队列** —— 该投影仅保留最新的命令；重连或重放的客户端会收敛到最终视图，不会观察到中间视图。
