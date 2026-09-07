# Agent Note: 显式启用空白会话 Conversation View

Status: implemented

[English](2026-09-05-blank-session-presentation-views.md) | 中文

## 问题

会话所属工作区可在任何聊天回合出现前提供有用控件。如果 Conversation shell 在出现 activity 前隐藏导航与 body，仅创建 Session 仍不足以访问这些控件。要求先发送消息会把呈现与无关的模型操作绑定；制造 activity 则会歪曲 Session 证据。

## 决策

[Conversation view registry](../../../../docs/subsystems/conversation.zh.md#blank-session-presentation)负责两个独立声明。`presentationOnly: true` 标识没有 event builder、snapshot 或 activity 贡献的 View。可选的 `supportsBlankSession: true` 允许在 Conversation activity 出现前使用控件，同样适用于事件驱动 View 和仅呈现 View。省略此项时，资格仍取决于 activity。

Shell 按 target id 关联已注册 Slot entry 与 View 能力。空白会话导航只包含 Chat 及显式启用的 View；Chat 仍为默认项，且没有空白 View body。真实空白 Session 具有可用的非 Chat 显式启用项时采用紧凑工作区导航，选择该 View 后渲染其控件。Registry 变化及释放更新同一个可观察 roster。Assembler 忽略仅呈现的 Definition，而不创建空 builder 或虚构 activity。Session lifecycle、事件历史与 Slot 注册语义保持不变。

[Micro Duck](../../../../packages/client/ui-robot-lab/README.zh.md)注册仅呈现的空白会话 View。Studio 通过现有 Session Controller 创建或打开 Session，再通过 [Conversation 所属 View 命令](2026-09-05-conversation-owned-view-commands.zh.md)选择 Micro Duck。该决策负责命令式选择与挂载安全的交付；资格仍由本文负责。注册能力或创建 Session 都不会保存项目、启动训练或调用模型。

## 考虑过的替代方案

**要求聊天或合成 activity。** 两者都让访问依赖与工作区无关的证据。伪造事件或 active target 还会扭曲 Session 与 Conversation 状态。

**为呈现控件注册空 builder。** 从自身会话所属服务读取数据的控件不需要事件聚合。显式联合类型为真正的事件驱动 View 保留 builder 义务，而不假装存在另一份 snapshot。

**增加功能专用 shell 分支或通用 Slot 选项。** 资格属于 Conversation 导航，不属于通用 renderer 或 Slot registry。与 target 无关的能力使其他 View 可以同样显式启用，而不在 shell 中写入 Micro Duck 名称。

## 影响

功能拥有者必须使用相同 target id 注册 View 能力与组件。空白会话支持只授予可见性，不授予授权或执行副作用的许可。未显式启用的 View 在 activity 出现前仍不可用；没有 Session 时仍遵循普通空白 composer 路径。人工审查及经过认证的构建后 GUI 验证，与源码层面的注册和测试相互独立。

本决策部分取代 [Conversation 组装](2026-08-09-client-conversation-node-assembly.zh.md)中一律省略空白 View 的规则，同时保留其事件驱动激活与回放理由。[Client 所有权决策](2026-08-20-client-session-conversation-ownership.zh.md)仍负责 Controller、adapter 与 renderer 的职责。更广泛的 [Studio 提案](../../proposed/feature/2026-09-04-microduck-studio.zh.md)仍为部分完成；空白会话访问不代表完成其入门学习、编舞或硬件要求。
