# Agent Note: Strict providers preserve optional tool arguments

Status: implemented

English | [中文](2026-09-04-strict-provider-optional-tool-arguments.zh.md)

## Problem

Harness tool schemas use standard JSON Schema requiredness: a property is optional when the containing object's `required` array omits its name. OpenAI strict function schemas instead require every declared property to appear in `required`, so sending the canonical schema cannot constrain sampling while preserving optional arguments. Treating those arguments as ordinary required values causes models to invent sandbox escalation fields on routine `bash`, `write`, and `edit` calls; the executor correctly rejects a request whose `sandbox_permissions` is not strictly wider than the current mode.

## Decision

The pi-ai provider profile exposes `strictToolSchemas`. A route enabling it strict-encodes each tool whose schema is fully closeable: it copies the schema, closes every object with `additionalProperties: false`, lists every property as required, gives each canonically optional non-nullable property a null branch, and requests required JSON-schema constrained sampling. A tool whose schema contains an irreducibly open object — an open map (`additionalProperties` truthy) or a typed object with no fixed properties, as MCP tools commonly declare — cannot be represented under OpenAI strict mode, so it is sent unchanged and left non-strict rather than distorted. The canonical Harness schema remains unchanged either way.

The response converter decodes only tools that were strict-encoded, and removes a null only when the corresponding property was optional and did not accept null before encoding. It preserves null for required or canonically nullable properties and applies the same rule within nested objects and arrays. Tool execution therefore receives omitted optional fields as absent properties and retains every legitimate null value.

The base `agency-copilot-gpt` route enables the codec and explicitly declares strict-mode support. Other routes retain their existing provider representation unless their deployment opts in.

## Alternatives considered

**Make escalation arguments required in the tool definitions.** Rejected because ordinary calls do not request escalation. This would encode a provider limitation into the canonical tool contract and trigger unnecessary or invalid permission requests.

**Disable strict sampling for the route.** Rejected because it gives up provider-side schema enforcement for every tool argument. The per-tool encodability gate keeps strict sampling for closeable first-party tools while sending open-schema tools unencoded.

**Force every tool strict by closing open objects with `additionalProperties: false`.** Rejected because closing an open map rejects the map entries it exists to carry, changing the tool's meaning; the provider would accept the schema but the tool would malfunction.

**Drop every null from returned arguments.** Rejected because null is a legitimate JSON value for schemas that explicitly accept it. Decoding is guided by the original property schema and removes only transport placeholders.

**Relax the strictly-wider escalation check.** Rejected because equal or narrower modes are not escalation. Weakening this security check would hide malformed calls rather than repair their schema representation.

## Consequences

Agency Copilot GPT can constrain tool calls while routine `bash`, `write`, and `edit` calls omit both escalation arguments. Explicit escalation still requires both arguments, user approval, and a mode strictly wider than the effective mode. Strict routes pay for a detached schema copy and response normalization on each request; non-strict routes keep the direct schema path.
