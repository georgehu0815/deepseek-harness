---
description: "Web GUI 的外壳布局：四栏 AppFrame、共享可视化工作区、拖动手柄、让步行为、面板几何与主题呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包提供 Web GUI 外壳：一个带可缩放侧栏、详情栏和可视化栏的四栏 AppFrame；一个供独立插件贡献标签的共享可视化工作区；一条保持中心栏下限的让步链；以及 `ctx.layout` 面板几何服务。它还承载主题呈现器，把解析后的配色方案、别名 token、正文字号与 `theme-color` 元数据投影到 document。需要标准窗口外观以及共享 Earth 或 Robot Lab 视图时选择它；面板几何与可视化选择是瞬时状态，重新加载即重置。

## 目录

- [使用本包](#use-this-package)
- [可视化工作区](#visual-workspace)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 root 槽位挂载本插件；它随即围绕侧栏、会话栏、详情栏与共享可视化工作区渲染应用框架。用户通过不可见命中条带缩放侧栏，通过浮动胶囊缩放详情栏或可视化栏。窗口变窄时，让步链依次收缩可视化栏、收缩详情栏、自动关闭可视化栏、自动关闭详情栏，以保持中心栏下限。关闭的侧栏保留 56px 控制栏；可选栏位关闭到零宽度。

### 主题呈现

呈现器消费解析后的主题快照，并投影到 document：`html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，把主题的别名 token 与 `--dsh-content-font-size` 设为 body 上的内联变量，并持有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新。释放呈现器时，它会连同其他全局写入一起移除自己的元数据节点。

-----

<a id="visual-workspace"></a>
## 可视化工作区

`visual.workspace.view` 是一个 `session-maybe` 列表 slot。插件通过 `id`、`order` 和 `label` 贡献条目；外壳派生标签元数据，并仅渲染选中的条目。`ctx.layout.openVisual(id)` 选择视图并打开栏位，不重置已经打开的宽度。`toggleVisual(id)` 仅在同一视图已经打开时关闭栏位，否则选择并打开请求的视图。`closeVisual()` 关闭栏位但保留选择。选中条目不可用时会显示明确提示，不会悄悄选择其他插件。

可视化偏好和选中标签是跨 Session 切换保留的根级查看状态。选中视图接收当前可选 Session 和实际渲染的 `width` owner 属性。关闭栏位或切换标签会卸载查看器，因此需要跨卸载保留的数据或服务器操作由消费方持有。外壳不导入 Earth 或 Robot 专属渲染器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一次 `register()` 调用把 `AppFrame` 贡献进运行时的内建 `'root'` 槽位，声明五个子槽位（`sidebar`、`conversation`、`details`、`visual.workspace.view`、`shell.overlay`）、安放查看 store，并接好 `ctx.layout` 面板动作服务。瞬时 store 以默认侧栏宽度、关闭的详情栏和可视化栏启动，从不读写 `localStorage`。AppFrame 将会话栏与详情栏保留在固定树位置，并仅渲染选中的可视化条目。已连接 Session 经 `SessionProvider` 渲染；可视化选择保留为根级查看状态，选中条目接收当前可选 Session。主题呈现器仍是独立 effect：从解析后的快照做纯 DOM 写入，初始状态经 getter 读取一次，此后仅由事件驱动，不经过 React。它先应用调色板、字号与 token 变量，再把渲染出的背景测量为唯一颜色依据。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当布局面不够用时阅读以下页面。它们从框架进入它所渲染的栏与它所呈现的主题。

- [ui-sidebar](../ui-sidebar/README.zh.md)——占据 `sidebar` 栏及其座位。
- [ui-conversation](../ui-conversation/README.zh.md)——占据 `conversation` 与 `details` 栏。
- [ui-theme](../ui-theme/README.zh.md)——呈现器消费其解析快照的主题 seam。
- [ui-geo-earth](../ui-geo-earth/README.zh.md)——向共享可视化工作区贡献 Earth 标签。
- [ui-robot-lab](../ui-robot-lab/README.zh.md)——向共享可视化工作区贡献 Robot Lab 标签。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前布局行为。它们是当前包约束，不是通用窗口管理器对比或任务积压。

- **面板几何与可视化选择是瞬时状态**——重新加载会恢复侧栏默认值并关闭可选栏位；在不同 Session id 之间切换也会关闭详情栏并忘记拖动后的宽度。
- **让步链自动关闭不改变偏好宽度**——窗口变宽时可视化栏与详情栏会恢复；消费方不得把存储宽度当作渲染真值。
- **同时仅渲染一个可视化视图**——需要后台数据的插件必须在组件生命周期之外持有数据。
- **挤压重排期间无滚动锚定**——布局变化可能移动读者的视口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。`ctx.layout` 后的 viewing-state store 不发出 Cordis 事件；栏位 clamp、可视化选择与让步顺序由本包的服务和栏位测试覆盖。
