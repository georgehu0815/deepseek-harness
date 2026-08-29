# @deepseek-ai/dsh-tool-geo-query

[English](README.md) | 中文

模型用于解析地点并发现底图影像的只读 geo 工具，基于 `ctx.geo` 接缝。属于 Terra geo 移植（第 1 阶段）。

## 功能说明

注册两个工具：

- `geo_geocode` —— 将自由文本地名解析为坐标（以及可用时的边界框）。
- `geo_list_basemaps` —— 列出可选择的底图影像预设。

两者都是只读且并发安全的；均不追加会话事件。

## 渲染

两者都使用通用工具卡片。`geo_geocode` 呈现为标题为 `Geocode "<query>"` 的 `fetch` 调用；`geo_list_basemaps` 呈现为标题为 `List base maps` 的 `other` 调用。

## 导出形态

函数插件：命名的 `name` / `inject` / `apply`，无默认导出。注入 `['tools', 'geo']`。

## Model Experience

### 工具模式

#### What the model sees

模型看到生成的 [`geo_geocode` 与 `geo_list_basemaps` 模式](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-query)。`geo_geocode(query, limit?)` —— `query` 是自由文本地名；`limit` 是最大匹配数（1–20，默认 5）。`geo_list_basemaps()` 不接受任何参数。

#### Token effect

在工具可见的每次请求上都有固定的模式开销。

#### KV Cache effect

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使复用失效。

### 工具调用历史与结果

#### What the model sees

`geo_geocode` 返回一个匹配的文本列表（`<name> — <lat>, <lon>`），或在为空时返回 `No matches for "<query>".`。`geo_list_basemaps` 每个预设返回一行 `<id> — <label>`。结果小而形态固定；地理编码依赖外部提供者，因此匹配文本是动态的。

#### Token effect

地理编码受 `limit` 约束（默认 5 个匹配），底图受固定预设数量约束。

#### KV Cache effect

仅追加；结果跟随可复用的请求前缀，不会使现有的 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **没有领域或目录查询** —— 机场/建筑/激光雷达图层、目录搜索与要素查找被推迟到后续阶段；参见[提议说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **地理编码质量取决于提供者** —— 默认公共提供者的精度与覆盖范围即 Nominatim 的；基于 Terra 的提供者可在接缝处替换。
