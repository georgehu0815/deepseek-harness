# @deepseek-ai/dsh-geo

[English](README.md) | 中文

geo 能力接缝：一个服务定义（`ctx.geo`）加上一个内置提供者，用于将地名解析为坐标并列出底图影像预设。它是 Terra geo 移植的宿主平面基础——查询与控制工具以及 3D 地球客户端都通过这一个服务读取。

## 功能说明

`ctx.geo` 暴露 `geocode(query, limit, signal)` 与 `listBaseMaps()`，以及用于替换当前地理编码器的 `registerProvider(provider)`。默认提供者（`public-nominatim`）通过 HTTPS 调用公共的 OpenStreetMap Nominatim，带有超时截止时间、响应字节上限以及手动重定向处理。底图预设（`osm`、`carto-dark`、`carto-light`、`esri-satellite`）是静态的，无需网络调用即可提供。

## 单一所有者

同一时间只有一个活动的地理编码提供者；`registerProvider` 返回一个释放器，并在释放时恢复先前的提供者。基于 Terra 的提供者可以替换内置提供者，而无需对工具或客户端做任何改动。

## 配置

已校验的 `Config`，均可从 cordis.yml 更改：

- `nominatimBaseUrl`（默认 `https://nominatim.openstreetmap.org`）——地理编码服务的源。
- `userAgent`（默认 `deepseek-harness-geo/0.1 (+https://github.com/deepseek-ai/deepseek-harness)`）——在每次地理编码请求上发送，如 Nominatim 的使用策略所要求。
- `geocodeTimeoutMs`（默认 `10000`）——每次请求的截止时间，以毫秒为单位。

## 导出形态

默认导出 `GeoRuntime` 服务类；将 `ctx.geo` 合并进 cordis 的 `Context`。`./client` 为浏览器侧重新导出接缝类型。

## Model Experience

### 能力接缝（无直接的模型面）

#### What the model sees

没有任何直接内容。本包不注册任何工具，也不添加任何提示文本；它是一个供其他插件消费的能力。模型只能通过 `@deepseek-ai/dsh-tool-geo-query`（地理编码、底图列举）触及它，其模式与结果在那里有文档说明。

#### Token effect

仅本包不产生任何影响。

#### KV Cache effect

仅本包不产生任何影响；消费方工具拥有各自的前缀效应。

## Known Limitations and Deferred Work

- **仅地理编码与底图预设** —— 目录搜索、领域图层以及要素数据（Terra 更丰富的 BFF 面）被推迟；参见[提议说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **默认提供者依赖一个公共服务** —— Nominatim 有速率限制并要求描述性的 `userAgent`；自托管或基于 Terra 的提供者才是通过 `registerProvider` 实现的预期生产路径。
- **底图预设是静态的** —— 这四个预设在代码中固定；按部署配置的影像源尚不可配置。
