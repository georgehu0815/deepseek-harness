# @deepseek-ai/dsh-tool-geo-query

[English](README.md) | 中文

模型用于解析地点、发现底图影像并读取领域要素图层的只读 geo 工具，基于 `ctx.geo` 接缝。属于 Terra geo 移植。

## 功能说明

注册六个工具：

- `geo_geocode` —— 将自由文本地名解析为坐标（以及可用时的边界框）。
- `geo_list_basemaps` —— 列出可选择的底图影像预设。
- `geo_catalog_search` —— 在 geo 数据目录中搜索匹配自由文本的数据集。
- `geo_domain_list` —— 列出活动提供者能够提供的领域要素图层，以及每个图层是否有数据。
- `geo_domain_query` —— 按细节层级获取某图层在边界框内的要素。
- `geo_feature_get` —— 按 id 获取某图层内的一个领域要素。

所有工具都是只读且并发安全的；均不追加会话事件。前两个工具可在内置的仅地理编码提供者上工作；四个领域工具需要一个领域数据提供者（例如 Terra BFF 提供者），否则会报告活动提供者不支持它们。

## 渲染

所有工具都使用通用工具卡片。`geo_geocode`、`geo_catalog_search`、`geo_domain_query` 与 `geo_feature_get` 呈现为 `fetch` 调用；`geo_list_basemaps` 与 `geo_domain_list` 呈现为 `other` 调用。

## 导出形态

函数插件：命名的 `name` / `inject` / `apply`，无默认导出。注入 `['tools', 'geo']`。

## Model Experience

### 工具模式

#### What the model sees

模型看到生成的 [tool-geo-query 模式](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-query)。`geo_geocode(query, limit?)` 解析地名；`geo_list_basemaps()` 不接受任何参数。`geo_catalog_search(query, limit?)` 搜索目录。`geo_domain_list()` 不接受任何参数。`geo_domain_query(domain, bbox, lod?)` —— `domain` 是图层 id（airports、cities、lakes、ports、railroads、roads、time-zones），`bbox` 是以度为单位的 `[west, south, east, north]`，`lod` 是 `world`/`regional`/`local`（默认 `regional`）。`geo_feature_get(domain, id)` 获取一个要素。未知的 domain 或格式错误的 bbox 值会在调用提供者之前被拒绝。

#### Token effect

在工具可见的每次请求上都有固定的模式开销。

#### KV Cache effect

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使复用失效。

### 工具调用历史与结果

#### What the model sees

`geo_geocode` 返回一个匹配的文本列表（`<name> — <lat>, <lon>`）。`geo_list_basemaps` 每个预设返回一行 `<id> — <label>`。`geo_catalog_search` 返回匹配的 `<id> — <title>` 条目。`geo_domain_list` 每个图层返回一行，带有其几何类型，并在为空时带有 `— no data` 标记。`geo_domain_query` 返回一行计数，标注细节层级以及结果是否被截断，外加以 GeoJSON 几何形式呈现的要素及其属性。`geo_feature_get` 返回该要素或 `No such feature.`。领域结果依赖活动提供者，因此其内容是动态的。

#### Token effect

地理编码与目录搜索受 `limit` 约束，底图受固定预设数量约束，领域查询受提供者按细节层级设定的要素上限约束。

#### KV Cache effect

仅追加；结果跟随可复用的请求前缀，不会使现有的 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **领域数据需要一个领域数据提供者** —— 四个领域工具在默认的仅地理编码提供者上返回不支持提供者的错误；接入一个基于 Terra 的提供者（`@deepseek-ai/dsh-host-geo-bff`）来提供它们。参见[设计说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **地理编码质量取决于提供者** —— 默认公共提供者的精度与覆盖范围即 Nominatim 的；基于 Terra 的提供者可在接缝处替换。
