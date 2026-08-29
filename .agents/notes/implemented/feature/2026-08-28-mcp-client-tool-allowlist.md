# Agent Note: mcp-client per-server tool allowlist

Status: implemented

English | [中文](2026-08-28-mcp-client-tool-allowlist.zh.md)

## Problem

`mcp-client` registers every tool an MCP server advertises. Composing several servers at once overflows the model's practical tool budget: a single Azure DevOps server exposes about ninety tools, and the DeepSeek function-name array does not scale to the union of many such servers. Claude Code plugins already solve this in their `.mcp.json` by narrowing each server's `tools` array to the handful a plugin actually calls, but DSH had no equivalent, so a faithful import of such a plugin could not stay within the tool budget. The gap also blocked native Claude Code plugin support, whose MCP translation step (`.mcp.json` → `cordis.yml`) needs a field to carry each server's allowlist.

## Decision

`Config` gains an optional `allowedTools?: string[]` on both the stdio and Streamable HTTP variants. When present, only server tools whose raw name matches an entry are registered; an omitted field preserves the prior behavior of registering every tool. Each entry is an exact raw name or a `prefix*` glob whose trailing `*` matches any suffix; a lone `*` matches everything, so `["*"]` is equivalent to omission.

Matching runs on the MCP server's own raw tool name, before public-name normalization, inside `syncTools` phase 1 — the single point where a discovered tool becomes a `ctx.tools` registration. A dropped tool never reaches the registry or the model. The pure matcher `toolAllowed(rawName, allowlist)` is exported for the translation tooling and tests.

`allowedTools` is a validated `Config` field (`z.array(String)`, omit-preserving so an absent value stays `undefined`), resolved into `ToolBridgeOptions` in `startConnection` — the explicit resolve step at the package boundary, not a hidden default inside the sync loop. The field participates in the same effect-scoped lifecycle as the rest of a generation: disposing a sync generation unregisters exactly the tools the allowlist admitted, with no residue for the tools it dropped.

## Alternatives considered

**A deny-list instead of, or in addition to, an allow-list.** The consumer evidence — Claude Code `.mcp.json` `tools` arrays — is an allow-list, and the budget problem is "keep only the few needed," which an allow-list states directly. `ToolRestriction` elsewhere in the codebase carries both `allow` and `deny`, but adding a `deny` here without a current consumer would be unsupported surface; it can be added when a real need appears.

**Filter at call time or in a `ctx.tools` guard rather than at registration.** A guard would still register every tool, so the model would see and could call them — the tool-budget problem is exactly the count of registered tools, so the decision must be enforced where registration happens. Filtering at registration also means a dropped tool leaves no schema tokens in the request.

**Match on the public `mcp__<server>__<tool>` name.** Plugin authors write raw names in `.mcp.json`, and public names are a lossy normalization (hashing on collision), so matching raw names keeps the allowlist authored against the names the author knows and avoids coupling the filter to normalization details.

**Regular expressions instead of `prefix*` globs.** The reference Claude Code harness and the plugins in hand use exact names and simple prefix globs; a full regex dialect is unneeded surface and a footgun in YAML. Exact + trailing-`*` covers every observed case.

## Testing

`packages/mcp/mcp-client/tests/mcp-client.spec.ts` adds unit coverage for `toolAllowed` (exact, `prefix*`, lone `*`, empty list) and, through the real `ToolRuntime`, integration coverage that an allowlist registers only matching tools, that an absent field registers all, and that disposing an allowlisted generation unregisters the admitted tool and leaves no residue for the dropped one — the HMR-safety contract for a registry contribution.

## Consequences

A deployment can now compose many MCP servers and keep the model's tool array within budget by narrowing each server, which is the enabling change for importing a Claude Code plugin's `.mcp.json` faithfully. The default is unchanged: without `allowedTools`, every server tool registers as before, so no existing composition is affected. The README documents the field and its model-facing effect — dropped tools reach neither the registry nor the request.

## Related

This adds one field to the plugin defined in [MCP client plugin](2026-07-07-mcp-client-plugin.md); that note owns the connection, discovery, and public-name mechanism, and [MCP client auto-reconnect](2026-08-06-mcp-client-auto-reconnect.md) owns the reconnect lifecycle the allowlisted generation participates in. Both remain the authority for their decisions.
