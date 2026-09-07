# Agent Note: Pi-ai unsupported unions fall back from strict sampling

Status: implemented

English | [中文](2026-09-05-pi-ai-structured-union-fallback.zh.md)

## Problem

The pi-ai JSON-schema constrained sampler rejects every `oneOf` and every object or array union, whether the schema expresses that union with `anyOf` or a `type` array. Encoding an optional non-null Harness object or array with a null alternative therefore makes otherwise valid tools such as `control_camera`, whose optional `bbox` is an array, fail before a model request.

## Decision

The strict tool-schema codec leaves the complete tool unchanged and non-strict when any node declares `oneOf`, an authored `type` union contains `object` or `array`, an optional object or array would need a null union, or an authored `anyOf` contains an object or array variant. Required objects and arrays remain strict-encodable and recurse into their properties or items. Optional scalar properties and authored scalar `anyOf` branches remain strict-encodable, and only their transport-introduced null placeholders are removed before tool execution. This per-tool fallback prevents `strict: 'require'` from reaching pi-ai with a schema form its constrained sampler rejects.

## Alternatives considered

**Encode every optional structured property as `anyOf`.** Rejected because pi-ai rejects object and array variants before the provider request.

**Encode optional structured values with a nullable `type` array.** Rejected because pi-ai rejects both nullable object unions and nullable array unions.

**Disable strict sampling for every tool on the route.** Rejected because required structured values and scalar-only tools retain useful provider-side schema enforcement.

## Consequences

Tools such as `control_camera` retain their canonical schemas by identity and remain non-strict, so returned null values are not treated as transport placeholders. Tools with required objects or arrays, optional scalars, or scalar `anyOf` branches retain strict constrained sampling.
