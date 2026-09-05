# Agent Note: Remote 命名空间的原子发布

Status: implemented

[English](2026-09-04-remote-namespace-atomic-publication.md) | 中文

## 问题

等待 `remote.<namespace>` 的 Cordis 消费方可能在 `ctx.remote.$mount()` 完成前激活。构造 namespace Service 会发布它的存在；先等待其 fiber，再安装方法，会形成依赖已满足而方法尚不存在的间隙。构建后的 supply-chain 消费方以 `catalog is not a function` 重现了此问题，尽管生成的贡献项包含该方法。重新构建元数据或添加 RPC 响应 fixture 都无法修复传输分发之前的失败。

## 决策

[Client gateway](../../../../packages/api/gateway/README.md) 用返回不可用状态的 `Service.check` 谓词准备 namespace fiber，同步安装整个贡献项的直接方法和作用域方法，然后通过 Cordis 通知发布新 namespace 的就绪状态。扩展会复用已有 namespace Service，且不会在方法安装之间让出执行权；已有消费方不会重启。

串行挂载队列仍是修改操作的所有者。回滚会先撤回失败贡献项自己的 token 和方法，再等待 namespace 清理。namespace 仅在最后一个贡献方法移除后卸载；保留的调用句柄会观察到撤回状态，正在进行的调用会被中止。

## 考虑过的替代方案

**重排应用插件或延迟消费方。** Loader 顺序不是就绪保证，消费方也已经声明了正确的 namespace 注入。让每个消费方自行等待会重复 gateway 的生命周期知识。

**安装第一个方法后就发布。** 后续方法和作用域变体仍会与消费方激活竞争。扩展方法之间让出执行权，也会在已有 namespace 上暴露不完整的方法批次。

**重新构建产物或扩展传输 fixture。** 它们能解决各自的故障，但不能修复 Service 过早可用的问题。

## 影响

生成的描述符、公开 Remote API 和消费方注入声明均不改变。Client 生命周期测试覆盖等待中的消费方、重新挂载、两种贡献项撤回顺序，以及成功或失败的扩展在微任务之间的可见性。构建产物的 Web 回归测试使用实际的 supply-chain 贡献项和 gateway factory，只替换外部 RPC 响应。Robot 的组装快照仍承担应用级检查。

[Remote 方法架构](../architecture/2026-08-02-typert-remote-method-calls.md)与[生成契约的构建顺序](../process/2026-08-08-api-remotes-generated-contract-build.md)仍是有效依据，未被取代；本决策在该设计内补充 namespace 的就绪保证。
