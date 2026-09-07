---
description: "具有显式快照、订阅与生命周期所有权的浏览器可观察状态 store。"
kind: "package-library"
---
# @deepseek-ai/dsh-client-store

[English](README.md) | 中文

## 概述

供 Client controller 与 renderer adapter 共用的不依赖 React 的 observable 和 snapshot-store 基础设施。本包负责同步与 animation-frame 发布、基于 Immer 的更新、浅比较和可选的浏览器持久化；React hook 的构造仍属于 `@deepseek-ai/dsh-client-ui-renderer`。当 Client 状态必须在不依赖 React 的情况下发布稳定 snapshot 时，请使用它。

## 目录

- [浏览器恢复](#browser-recovery)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="browser-recovery"></a>
## 浏览器恢复

`defineStore` 的可选 `persist` 接受用于旧式整状态 JSON 的字符串，或用于显式部分状态恢复的 `ProtectedPersistence<T>` 对象。省略时 store 仅保留在内存中。对象提供载荷选择器、带验证的恢复编解码器、版本、完整信封的 UTF-8 字节限制、通知投影和 `scopeDisposal: 'retain'`。[Slots 参考](../../../docs/subsystems/slots.zh.md#protected-recovery)定义这些类型。旧式键与原始 JSON 格式保持不变。

受保护恢复同步执行，检查信封字段、版本、准确作用域和载荷后，才与新的初始状态合并。写入要求浏览器 Web Locks，并在锁内比较先前观察到的准确原始记录。缺少锁服务时仍可能恢复有效记录，但绝不进行无保护写入。数据无效、版本不支持、大小或存储失败及修订冲突会阻止该实例后续自动写入，不替换已保存字节，也不回滚本地编辑。`PersistNotice` 区分待保存、已恢复、已保存及这些失败状态；它不属于选取的载荷。

`dispose()` 同步取消持久化副作用与排队写入；本地 actions 仍可用，但不能写存储。受保护的 `clearPersisted()` 返回 promise，取消待保存操作，并在同一锁内仅删除观察到的修订。实例已阻止、释放或清除，或者存储修订已变化时，它会拒绝。旧式清理仍同步执行，失败不致命。Renderer 释放保留受保护记录；它不代表永久删除 Session。[恢复决策](../../../.agents/notes/implemented/architecture/2026-09-05-protected-browser-authoring-recovery.zh.md)负责此保留与冲突策略。

<a id="model-experience"></a>
## 模型体验

无，因为本包提供浏览器侧状态基础设施，不注册任何面向模型的内容。

#### KV Cache 影响

无；这些 store 既不组装也不发送模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **持久化是浏览器本地明文**——`localStorage` 中的 JSON 既未加密，也不提供跨设备同步。受保护记录不会自动迁移或清理，包括作用域或应用释放后。缺少存储或 Web Locks 时，编辑仍留在本地，保护机制报告无法保存的原因。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只导出库引擎，不创建进程级状态；每个 store 实例由其所属测试覆盖。
