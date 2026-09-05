# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件提供四栏 AppFrame 和 `ctx.layout` 面板几何服务。它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`details`、`visual.workspace.view` 和 `shell.overlay`。轨道为 `sidebar | center | details | visual`。侧栏缩放边界为不可见命中条带，详情栏和可视化栏边界带有浮动胶囊。让步链依次收缩可视化栏、收缩详情栏、自动关闭可视化栏、自动关闭详情栏，以保持中心栏下限。侧栏从不让步；关闭后仍保留 56px 控制栏。

## 可视化工作区

`visual.workspace.view` 是具有 `session-maybe` 作用域的列表 slot。插件通过 `id`、`order` 和 `label` 贡献独立条目；外壳经框架绑定的可观察对象派生标签元数据，并仅渲染选中条目。`ctx.layout.openVisual(id)` 选择视图并打开栏位，不重置已经打开的宽度。`toggleVisual(id)` 仅在同一视图已经打开时关闭栏位，否则选择并打开请求的视图。`closeVisual()` 关闭栏位但保留选择。选中条目不可用时显示明确提示，不会悄悄切换到其他插件。注册方接收实际渲染 `width` owner 属性和标准会话钩子；业务操作来自各自的 inject 接口。

可视化栏偏好和选中标签是根级查看状态，跨会话切换保留。选中视图接收当前可选会话。关闭栏位或切换标签会卸载查看器；需要跨卸载保留的数据或服务器操作由消费方自己持有。外壳不导入任何 Earth 或 Robot 专属渲染器。

## 几何与主题

瞬时布局 store 以默认侧栏宽度、关闭的详情栏和可视化栏启动，从不读写 `localStorage`。会话栏和详情栏保留固定树位置。hero 和其他未选中状态派生出零详情栏宽度，但不改变存储偏好。首个 Session 保持关闭；显式打开详情栏使用默认宽度，返回同一 Session 保留该宽度，选择另一 Session 则在绘制前关闭详情栏。侧栏 owner 属性为 `collapsed` 和 `width`；会话栏及详情栏 owner share 为空。

主题呈现器将解析后的 `ctx.theme` 快照投影到文档：`html { color-scheme }`、`body[data-ds-dark-theme]`、body 上的内联别名 token，以及应用 token 后根据 body 计算背景色生成的自有 `<meta name="theme-color">`。dispose（资源释放）移除元数据节点和其他自有全局写入。

`/client` 导出包含插件加载符号、`LayoutController` 和公开类型约定。AppFrame、查看 store、标签元数据适配器和让步求解器均为内部实现。

## 模型体验

无：布局管理浏览器查看状态，不注入模型上下文。

#### KV Cache 影响

无；此包不组装提供商请求。

## 已知限制与延期工作

- 面板几何和可视化选择是瞬时状态；重新加载后可选栏位恢复关闭。切换不同 Session id 也会关闭详情栏并忘记拖动宽度。
- 让步链自动关闭不改变偏好宽度。窗口变宽时可视化栏和详情栏恢复；存储宽度不等于渲染宽度。
- 同时仅渲染一个可视化视图。需要后台数据的插件必须在组件生命周期之外持有数据。
- 布局变化可能移动阅读视口；挤压重排不提供滚动锚定。
