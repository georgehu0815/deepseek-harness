# Agent Note: 严格提供方保留可选工具参数

Status: implemented

[English](2026-09-04-strict-provider-optional-tool-arguments.md) | 中文

## Problem

Harness 工具 schema 使用标准 JSON Schema 的 required 语义：若所在对象的 `required` 数组不含某属性名，该属性即为可选。OpenAI 严格函数 schema 则要求每个已声明属性都出现在 `required` 中，因此直接发送规范 schema 无法同时约束采样并保留可选参数。若将这些参数作为普通必填值，模型会在常规 `bash`、`write` 与 `edit` 调用中编造 sandbox 提权字段；执行器会正确拒绝 `sandbox_permissions` 不严格宽于当前模式的请求。

## Decision

pi-ai 提供方 profile 提供 `strictToolSchemas`。启用该项的路由只对 schema 完全可关闭的工具做严格编码：复制 schema，以 `additionalProperties: false` 关闭每个对象，将所有属性列为 required，为规范 schema 中可选且不可为 null 的属性增加 null 分支，并要求强制 JSON-schema 约束采样。若工具 schema 含不可消除的开放对象——开放映射（`additionalProperties` 为真）或没有固定 properties 的类型化对象（MCP 工具常如此声明）——则无法在 OpenAI 严格模式下表示，因此原样发送并保持非严格，而非扭曲它。无论哪种情况，Harness 的规范 schema 均保持不变。

响应转换器只解码经过严格编码的工具，且仅当对应属性原本可选且编码前不接受 null 时移除 null。required 属性与规范 schema 中可为 null 的属性会保留 null；同一规则也应用于嵌套对象与数组。工具执行阶段因而把可选字段的 null 占位符恢复为缺失属性，同时保留所有合法 null 值。

基础 `agency-copilot-gpt` 路由启用该 codec，并显式声明支持严格模式。其他路由继续使用现有提供方表示，除非部署主动启用。

## Alternatives considered

**在工具定义中将提权参数改为 required。** 拒绝，因为常规调用不请求提权。这会把提供方限制写入规范工具约定，并触发不必要或无效的权限请求。

**为整条路由禁用严格采样。** 拒绝，因为这会放弃所有工具参数的提供方 schema 强制检查。按工具的可编码性判定既为可关闭的一方工具保留严格采样，又对开放 schema 的工具原样发送。

**通过以 `additionalProperties: false` 关闭开放对象来强制每个工具严格。** 拒绝，因为关闭开放映射会拒绝它本应承载的映射项，改变工具语义；提供方虽接受该 schema，但工具会失效。

**删除返回参数中的所有 null。** 拒绝，因为显式接受 null 的 schema 将其视为合法 JSON 值。解码由原始属性 schema 指导，只移除传输占位符。

**放宽“必须严格更宽”的提权检查。** 拒绝，因为相同或更窄的模式并非提权。弱化该安全检查只会掩盖错误调用，而不会修复 schema 表示。

## Consequences

Agency Copilot GPT 可以约束工具调用，同时常规 `bash`、`write` 与 `edit` 调用可省略两个提权参数。显式提权仍要求同时提供两个参数、获得用户批准，并且目标模式严格宽于有效模式。严格路由每次请求需复制 schema 并规范化响应；非严格路由继续使用直接 schema 路径。
