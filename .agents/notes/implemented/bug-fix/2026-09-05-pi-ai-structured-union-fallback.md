# Agent Note: Pi-ai unsupported unions fall back from strict sampling

Status: implemented

English | [中文](2026-09-05-pi-ai-structured-union-fallback.zh.md)

## Problem

The pi-ai JSON-schema constrained sampler rejects every `oneOf` and any `anyOf` variant that contains an object or array schema. Encoding every optional non-null Harness property as an `anyOf` null branch therefore makes otherwise valid tools such as `control_camera`, whose optional `bbox` is an array, fail before a model request. Optional objects cannot use pi-ai's accepted nullable-array representation without changing their value type.

## Decision

The strict tool-schema codec represents an exact-type optional array with `type: ['array', 'null']`, preserving its other keywords and recursively encoded items. Returned null placeholders for these arrays are removed under the same original-schema rule as scalar placeholders.

The codec leaves the complete tool unchanged and non-strict when any node declares `oneOf`, an optional property needs another structured union, or an authored `anyOf` contains an object or array variant. Scalar `anyOf` null branches remain strict-encodable. This per-tool fallback prevents `strict: 'require'` from reaching pi-ai with a schema form its constrained sampler rejects.

## Alternatives considered

**Encode every optional structured property as `anyOf`.** Rejected because pi-ai rejects object and array variants before the provider request.

**Encode optional objects with a nullable `type` array.** Rejected because pi-ai rejects nullable object unions, so this only moves the failure to another unsupported representation.

**Disable strict sampling for every tool on the route.** Rejected because exact-type optional arrays have a supported representation, and scalar-only tools retain useful provider-side schema enforcement.

## Consequences

Tools such as `control_camera` retain required constrained sampling and receive omitted optional arrays as absent arguments. Tools with `oneOf` or unsupported structured unions retain their canonical schemas and returned null values, but pi-ai does not constrain those tools strictly.
