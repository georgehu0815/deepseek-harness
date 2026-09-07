# Agent Note: Conversation 所属的 View 命令

Status: implemented

[English](2026-09-05-conversation-owned-view-commands.md) | 中文

## 问题

打开 Session 和激活 target 数据都不等于选择 Conversation View。Studio 入口需要在 Session body 尚未挂载时也能到达控件。写入第二个 store 实例、卸载后保留回调或重放迟到的创建结果，可能选择错误的 View 或 Session。

## 决策

[UiConversation](../../../../packages/client/ui-conversation/README.zh.md)拥有 `selectView(sessionId, target)`。它只接受当前已知 Session binding，以及已安装且对该 Session 合格的 View。必需的同步构造器工厂在 registry 初始化后接收 service，并提供其 owner 命令；不增加 client 值导出或通用 Slot 能力。

实际 Conversation body 通过 owner 布局生命周期回调绑定其声明的 View store action。命令立即到达已挂载 action，或仅等待首次已提交挂载一次。只保留最新待交付命令；它不是镜像选择值。现有 tab 与 focus actions 仍负责普通用户导航。

交付重新检查 Session 身份与 binding 代际、已安装 target 及空白会话资格。更新的 owner 手势、Session 或 binding 变化、target 撤回或能力丢失、body 卸载、作用域释放及 HMR 都取消尚未交付的命令。身份安全的清理不能移除更新的写入方。延迟计时器、DOM 点击或 target 数据激活都不能代替提交 UI 选择。

[Robot Studio](../../../../packages/client/ui-robot-lab/README.zh.md)在显式 Start 或 Open 成功后使用此命令。取消迟到导航不取消已准入的 Session 创建。选择绝不保存项目、启动训练、调用模型或创建 Conversation activity。

## 考虑过的替代方案

**每次 Studio 进入后都要求手动选择标签页。** 这使显式入口操作未能到达请求的目标。领域所属命令选择已有 View，无需为功能增加 shell 分支。

**调用 `binding.activate` 或独立实例化 View store。** 激活控制 target 组装，而非选中的 UI 状态；另一个 store 实例不是 renderer 当前声明的实例。两种操作都不能交付用户导航请求。

**导出实现值或增加全框架导航 prop。** 其他领域需要的是兼容 JSON 的命令，而不是 Conversation 内部所有权。注入的 service 与普通 owner 回调保留现有模块及 props 规则。

## 影响

[空白会话呈现决策](2026-09-05-blank-session-presentation-views.zh.md)继续负责相互独立的仅呈现与空白会话能力。本决策只取代其手动进入要求及不提供命令式选择命令的部分。Chat fallback、View 资格和事件驱动激活保留现有拥有者。源码层交付与取消不能证明经过认证的构建后 GUI 验证或完整 Studio 流程的人工验收已通过。
