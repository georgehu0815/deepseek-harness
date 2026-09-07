# Agent Note: Pi-ai 不受支持的联合回退为非严格采样

Status: implemented

[English](2026-09-05-pi-ai-structured-union-fallback.md) | 中文

## Problem

pi-ai 的 JSON-schema 约束采样器会拒绝所有 `oneOf` 以及所有对象或数组联合，无论 schema 通过 `anyOf` 还是 `type` 数组表达该联合。因此，为不可为 null 的 Harness 可选对象或数组编码 null 替代项，会让 `control_camera` 这类原本有效的工具在模型请求前失败；该工具的可选 `bbox` 是数组。

## Decision

当任一节点声明 `oneOf`、已有 `type` 联合包含 `object` 或 `array`、可选对象或数组需要 null 联合，或已有 `anyOf` 包含对象或数组变体时，严格工具 schema codec 会让整个工具保持原样和非严格。必需对象与数组仍可严格编码，并递归处理其属性或 items。可选标量属性与已有标量 `anyOf` 分支仍可严格编码，并且只有传输层引入的 null 占位符会在工具执行前移除。该逐工具回退可防止 `strict: 'require'` 将约束采样器会拒绝的 schema 形式传给 pi-ai。

## Alternatives considered

**把每个可选结构化属性编码为 `anyOf`。** 拒绝，因为 pi-ai 会在提供方请求前拒绝对象与数组变体。

**使用 nullable `type` 数组编码可选结构化值。** 拒绝，因为 pi-ai 会拒绝 nullable 对象联合与 nullable 数组联合。

**为路由上的每个工具禁用严格采样。** 拒绝，因为必需结构化值与仅含标量的工具仍可保留有用的提供方 schema 强制检查。

## Consequences

`control_camera` 等工具按对象标识保留其规范 schema，并保持非严格，因此返回的 null 值不会被视为传输层占位符。含必需对象或数组、可选标量或标量 `anyOf` 分支的工具保留严格约束采样。
