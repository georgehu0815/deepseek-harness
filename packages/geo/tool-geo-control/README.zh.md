# @deepseek-ai/dsh-tool-geo-control

[English](README.md) | 中文

让模型驱动实时 3D 地球视图的动作工具——移动相机、切换底图影像、开关领域数据图层，以及绘制或编辑标注要素——通过追加客户端桥接会应用的 `geo/command` 会话事件实现。属于 Terra geo 移植（第 3 阶段）。

## 功能说明

注册十个工具：

- `control_camera` —— 将相机飞向一个地理目标。
- `set_basemap` —— 切换底图影像预设。
- `toggle_domain` —— 显示或隐藏一个领域数据图层（`airports`、`cities`、`lakes`、`ports`、`railroads`、`roads`、`time-zones`）。
- `draw_point` / `draw_polyline` / `draw_polygon` —— 绘制一个标注要素并返回其铸造的 id。
- `move_feature` —— 按 `[lon, lat]` 度增量平移一个已绘制要素。
- `set_feature_properties` —— 重命名一个已绘制要素。
- `delete_features` —— 按 id 删除已绘制要素。
- `undo_draw` —— 删除最近绘制的要素。

每个工具都向调用 agent 的会话追加一个 `geo/command` 事件；`geoCommand` 投影（来自 `@deepseek-ai/dsh-geo-command`）将其折叠为最新命令加上累积的启用图层与已绘制要素，浏览器桥接驱动地球。非 agent 调用者会被拒绝。

## 要素 id 可重放稳定

绘制工具从会话的下一个事件序号（即 `draw-feature` 事件本身占据的 seq）铸造 id `feat-<seq>`。由于日志按序号顺序折叠，重放同一日志会重建相同的 id，因此 `move_feature`、`set_feature_properties` 与 `delete_features` 在重放中保持有效，而无需客户端分配 id。

## 强制执行

当没有拥有它的 agent 时，每个工具的 `execute` 都抛出 `<tool> requires an owning agent session`，因此直接或替代的调用者无法在没有会话的情况下追加命令。`toggle_domain` 在追加前拒绝未知领域；绘制工具还拒绝超出范围的坐标、点数不足以及格式错误的 `[lon, lat]` 对。

## 渲染

通用工具卡片。`control_camera` 呈现为 `Move camera to <lat>, <lon>`；`set_basemap` 呈现为 `Set base map <id>`；`toggle_domain` 呈现为 `Show domain <id>` / `Hide domain <id>`；绘制工具呈现为 `Draw point <lon>, <lat>` / `Draw polyline` / `Draw polygon`；`move_feature` 呈现为 `Move feature <id>`；`set_feature_properties` 呈现为 `Rename feature <id>`；`delete_features` 呈现为 `Delete <n> feature(s)`；`undo_draw` 呈现为 `Undo last drawing`。

## 导出形态

函数插件：命名的 `name` / `inject` / `apply`，无默认导出。注入 `['tools']`。

## Model Experience

### 工具模式

#### What the model sees

模型看到生成的[地球控制工具模式](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-control)。`control_camera(lat, lon, height?)` —— 纬度 −90..90，经度 −180..180，两者都被钳制；`height` 是以米为单位的相机高度（默认 2,000,000）。`set_basemap(id)` —— 来自 `geo_list_basemaps` 的底图预设 id。`toggle_domain(domain, on)` —— 一个已知领域 id 与一个布尔值。`draw_point(lon, lat)`、`draw_polyline(coordinates)`（≥2 个 `[lon, lat]` 点）、`draw_polygon(coordinates)`（一个 ≥3 个点的环）、`move_feature(id, dLon, dLat)`、`set_feature_properties(id, name)`、`delete_features(ids)`、`undo_draw()`。

#### Token effect

在工具可见的每次请求上都有固定的模式开销。

#### KV Cache effect

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使复用失效。

### 工具调用历史与结果

#### What the model sees

`control_camera` 返回 `Camera moved to <lat>, <lon> at <height> m.`；`set_basemap` 返回 `Base map set to <id>.`；`toggle_domain` 返回 `Domain <id> shown.` / `Domain <id> hidden.`；绘制工具返回 `Drew <point|polyline|polygon> <id>.`；`move_feature` 返回 `Moved feature <id>.`；`set_feature_properties` 返回 `Updated feature <id>.`；`delete_features` 返回 `Deleted <n> feature(s).`；`undo_draw` 返回 `Removed the most recent drawn feature.` 稳定的失败是拥有会话的错误、未知领域与非空 id 错误，以及坐标与点数校验错误。`geo/command` 会话事件是 UI 和重放状态，不是第二条模型消息。

#### Token effect

小而形态固定的结果；追加的命令不会重新发送给模型。

#### KV Cache effect

仅追加；结果跟随可复用的请求前缀，不会使现有的 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **渲染新图层被推迟** —— 该接缝与投影携带启用领域与已绘制要素，但在地球上绘制它们的 Cesium 控制器（以及图层控制界面）将在后续客户端阶段落地；参见[提议说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **相机与底图末位胜出** —— `geoCommand` 投影通过客户端桥接重放最新的相机/底图命令，因此快速连续的移动会收敛到最终的一个，而不是逐步动画每一步。领域开关与已绘制要素则会累积。
- **仅重命名，无自由属性** —— `set_feature_properties` 设置显示名称；任意属性映射不属于面向模型的模式。
- **浏览器必须正在显示地球** —— 命令应用于共享的客户端控制器；在没有挂载查看器时，累积状态会被记住并在挂载时应用，而相机飞行则被丢弃。
