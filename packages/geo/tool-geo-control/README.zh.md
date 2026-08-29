# @deepseek-ai/dsh-tool-geo-control

[English](README.md) | 中文

让模型驱动实时 3D 地球视图的动作工具——移动相机并切换底图影像——通过追加客户端桥接会应用的 `geo/command` 会话事件实现。属于 Terra geo 移植（第 2 阶段）。

## 功能说明

注册两个工具：

- `control_camera` —— 将相机飞向一个地理目标。
- `set_basemap` —— 切换底图影像预设。

每个工具都向调用 agent 的会话追加一个 `geo/command` 事件；`geoCommand` 投影（来自 `@deepseek-ai/dsh-geo-command`）对其进行折叠，浏览器桥接驱动地球。非 agent 调用者会被拒绝。

## 强制执行

当没有拥有它的 agent 时，`execute` 抛出 `control_camera requires an owning agent session` / `set_basemap requires an owning agent session`，因此直接或替代的调用者无法在没有会话的情况下追加命令。

## 渲染

通用工具卡片。`control_camera` 呈现为 `Move camera to <lat>, <lon>`；`set_basemap` 呈现为 `Set base map <id>`。

## 导出形态

函数插件：命名的 `name` / `inject` / `apply`，无默认导出。注入 `['tools']`。

## Model Experience

### 工具模式

#### What the model sees

模型看到生成的 [`control_camera` 与 `set_basemap` 模式](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geo-control)。`control_camera(lat, lon, height?)` —— 纬度 −90..90，经度 −180..180，两者都被钳制；`height` 是以米为单位的相机高度（默认 2,000,000）。`set_basemap(id)` —— 来自 `geo_list_basemaps` 的底图预设 id。

#### Token effect

在工具可见的每次请求上都有固定的模式开销。

#### KV Cache effect

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使复用失效。

### 工具调用历史与结果

#### What the model sees

`control_camera` 返回 `Camera moved to <lat>, <lon> at <height> m.`；`set_basemap` 返回 `Base map set to <id>.` 稳定的失败是上面两个拥有会话的错误以及 `set_basemap requires a non-empty base-map id`。`geo/command` 会话事件是 UI 和重放状态，不是第二条模型消息。

#### Token effect

小而形态固定的结果；追加的命令不会重新发送给模型。

#### KV Cache effect

仅追加；结果跟随可复用的请求前缀，不会使现有的 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **仅相机与底图** —— `toggle_domain`、`draw_*` 与要素移动控制被推迟到后续阶段；参见[提议说明](../../../.agents/notes/proposed/architecture/2026-08-20-design-terra-geo-plugin-dsh.md)。
- **末位胜出语义** —— `geoCommand` 投影仅携带最新期望的视图，因此快速连续的命令会收敛到最终的一个，而不是逐步动画每一步。
- **浏览器必须正在显示地球** —— 命令应用于共享的客户端控制器；在没有挂载查看器时，底图会被记住并在挂载时应用，而相机飞行则被丢弃。
