# Agent Note: Pi-ai 不受支持的联合回退为非严格采样

Status: implemented

[English](2026-09-05-pi-ai-structured-union-fallback.md) | 中文

## Problem

pi-ai 的 JSON-schema 约束采样器会拒绝所有 `oneOf`，也会拒绝包含对象或数组 schema 的 `anyOf` 变体。因此，把每个不可为 null 的 Harness 可选属性编码为带 null 分支的 `anyOf`，会让 `control_camera` 这类原本有效的工具在模型请求前失败；该工具的可选 `bbox` 是数组。可选对象无法使用 pi-ai 接受的 nullable 数组表示，除非改变其值类型。

## Decision

严格工具 schema codec 使用 `type: ['array', 'null']` 表示精确类型的可选数组，并保留其其他关键字及递归编码的 items。返回参数中这些数组的 null 占位符按标量占位符所用的原始 schema 规则移除。

当任一节点声明 `oneOf`、可选属性需要其他结构化联合，或已有 `anyOf` 包含对象或数组变体时，codec 会让整个工具保持原样和非严格。标量 `anyOf` null 分支仍可严格编码。该逐工具回退可防止 `strict: 'require'` 将约束采样器会拒绝的 schema 形式传给 pi-ai。

## Alternatives considered

**把每个可选结构化属性编码为 `anyOf`。** 拒绝，因为 pi-ai 会在提供方请求前拒绝对象与数组变体。

**使用 nullable `type` 数组编码可选对象。** 拒绝，因为 pi-ai 会拒绝 nullable 对象联合，此方案只会把失败转移到另一种不受支持的表示。

**为路由上的每个工具禁用严格采样。** 拒绝，因为精确类型的可选数组存在受支持的表示，并且仅含标量的工具仍可保留有用的提供方 schema 强制检查。

## Consequences

`control_camera` 等工具保留强制约束采样，并把省略的可选数组作为缺失参数接收。含 `oneOf` 或不受支持结构化联合的工具保留其规范 schema 与返回的 null 值，但 pi-ai 不会严格约束这些工具。
