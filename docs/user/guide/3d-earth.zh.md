# 探索 3D 地球

[English](3d-earth.md) | 中文

agent 可以根据你的提示驱动一个可交互的 3D 地球：把相机飞往某地、切换底图影像、开关地理数据图层，以及绘制点、线、面等标注。你用自然语言描述想要什么，agent 调用地理工具，地球随之响应。

本指南假定 Web UI 已在运行（见[使用 Web UI](./index.md)），并已配置好工作区与模型。

## 新增功能

agent 现在拥有一整套地理控制工具：

- **相机** —— 以指定高度飞往任意经纬度。
- **底图** —— 在影像预设之间切换（`osm`、`carto-dark`、`carto-light`、`esri-satellite`）。
- **领域图层** —— 显示或隐藏内置数据图层：`airports`、`cities`、`lakes`、`ports`、`railroads`、`roads`、`time-zones`。
- **绘制** —— 绘制点、折线或多边形；移动、重命名、删除或撤销已绘制的要素。

每条命令都记录在会话中，因此你先前绘制的图形在重新加载或恢复时仍是地图状态的一部分——地球会从会话历史重建启用的图层与已绘制的要素，而不依赖一个必须保持打开的实时连接。

> **当前的渲染范围。** 相机移动与底图切换会立即出现在地球上。领域图层与绘制现在会被记录并累积进地图状态；这些图层与图形在地球上的渲染将在后续更新中到来。你今天就可以通过 agent 的回复驱动并验证整套命令集，如下所述。

## 打开地球

1. 在侧栏底部点击 **Earth 3D**。外壳右侧、对话旁边会打开一个可调整大小的地球列。
2. 使用列头隐藏地球（引擎保持挂载，再次显示时是即时的）或关闭该列。

## 移动相机

让 agent 飞往某处。对于地名，它会先把名称解析为坐标，再移动相机：

> 飞往东京并较近地放大。

agent 调用 `control_camera`，并回复类似 `Camera moved to 35.6762, 139.6503 at 15000 m.` 的一行。地球会动画过渡到新视图。你也可以直接给出坐标：

> 把相机移动到纬度 40.71、经度 -74.01，高度 15 千米。

纬度须在 −90 到 90 之间，经度须在 −180 到 180 之间。

## 切换底图

> 把底图切换为卫星影像。

agent 用 `esri-satellite` 调用 `set_basemap`，并回复 `Base map set to esri-satellite.` 请求 `carto-dark` 获得深色主题，或 `osm` 回到默认的 OpenStreetMap 瓦片。

## 开关一个数据图层

> 显示 airports 图层。

agent 调用 `toggle_domain`，并回复 `Domain airports shown.` 再次隐藏它：

> 隐藏 airports 图层。

它会回复 `Domain airports hidden.` 可用图层为 `airports`、`cities`、`lakes`、`ports`、`railroads`、`roads` 与 `time-zones`。启用的图层会累积：在 `airports` 之后显示 `cities` 会同时保留两者开启。

## 绘制标注

### 绘制一个点

> 在经度 139.78、纬度 35.55 处放一个点。

agent 调用 `draw_point`，并回复 `Drew point feat-1.` 回复中包含该要素的 id（这里是 `feat-1`）。id 按你绘制的顺序分配，因此第一个要素为其占据的序列位置对应的 `feat-<n>`——agent 会告诉你确切的 id，之后你用该 id 引用它。

### 绘制一条线或一个面

> 绘制一条经过 [139.70, 35.68]、[139.75, 35.70] 与 [139.80, 35.66] 的折线。

`draw_polyline` 需要至少两个 `[经度, 纬度]` 点，并回复 `Drew polyline feat-2.`

> 绘制一个围绕 [139.70, 35.65]、[139.80, 35.65]、[139.80, 35.72] 与 [139.70, 35.72] 的多边形。

`draw_polygon` 需要一个至少三点的环，并回复 `Drew polygon feat-3.`

### 移动、重命名、删除与撤销

用 agent 报告的 id 引用某个要素：

> 把要素 feat-1 向东移动经度 0.1 度。

`move_feature` 按经/纬度增量平移要素，并回复 `Moved feature feat-1.`

> 把要素 feat-1 重命名为 “Dock entrance”。

`set_feature_properties` 设置显示名称，并回复 `Updated feature feat-1.`

> 删除要素 feat-2 与 feat-3。

`delete_features` 删除它们，并回复 `Deleted 2 feature(s).`

> 撤销上一次绘制。

`undo_draw` 删除最近绘制的要素，并回复 `Removed the most recent drawn feature.`

## 一个完整示例

依次发送这些指令，观察 agent 的回复逐步构建地图状态：

1. > 飞往东京，较近一些。
2. > 把底图切换为卫星。
3. > 显示 airports 图层。
4. > 在经度 139.78、纬度 35.55 处放一个点，并告诉我它的 id。
5. > 把那个要素重命名为 “Haneda”。
6. > 撤销上一次绘制。

第 4 步后 agent 会报告一个要素 id（例如 `feat-1`）；若 agent 询问，第 5 步就用它。到第 6 步该点被再次删除，airports 图层仍然开启，底图仍是卫星——相机与底图反映你最新的命令，而图层与绘制则累积。

## 提示与限制

- **用 id 引用要素。** 绘制工具在回复中返回 id；`move`、`rename` 与 `delete` 都用该 id。
- **移动用增量，而非绝对位置。** `move_feature` 按以度为单位的经/纬度偏移平移要素。
- **只有一个地球。** Earth 列承载单个地球；没有分屏或多视图。
- **实时相机移动需要地球正在显示。** 列关闭时，最新的底图会被记住并在你重新打开时应用，而其间发出的相机飞行不会被重放。

## 相关

- [使用 Web UI](./index.md)
- [配置模型](./providers.md)
